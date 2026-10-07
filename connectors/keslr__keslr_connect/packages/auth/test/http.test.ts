import { describe, expect, it, vi } from 'vitest';
import { backoffDelayMs, requestJson } from '../src/http.js';
import { noopLogger } from '../src/logger.js';

const baseOptions = {
  timeoutMs: 500,
  maxRetries: 2,
  logger: noopLogger,
  operation: 'test',
};

describe('backoffDelayMs', () => {
  it('grows exponentially in its ceiling', () => {
    const alwaysMax = () => 0.999999;
    expect(backoffDelayMs(0, alwaysMax)).toBeLessThan(backoffDelayMs(1, alwaysMax));
    expect(backoffDelayMs(1, alwaysMax)).toBeLessThan(backoffDelayMs(2, alwaysMax));
  });

  it('caps at 2000ms', () => {
    expect(backoffDelayMs(20, () => 0.999999)).toBeLessThanOrEqual(2000);
  });

  it('applies full jitter, so the floor is zero', () => {
    expect(backoffDelayMs(5, () => 0)).toBe(0);
  });

  it('never returns a negative delay', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(backoffDelayMs(attempt)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('requestJson', () => {
  it('parses a JSON response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const result = await requestJson<{ ok: boolean }>('https://x.test/a', {
      ...baseOptions,
      fetch: fetchImpl,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
  });

  it('returns non-2xx responses rather than throwing, so OAuth errors are readable', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );

    const result = await requestJson<{ error: string }>('https://x.test/token', {
      ...baseOptions,
      fetch: fetchImpl,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_grant');
  });

  it('retries a GET on 500 and succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls < 3
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await requestJson<{ ok: boolean }>('https://x.test/a', {
      ...baseOptions,
      fetch: fetchImpl,
    });

    expect(result.body.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response('{}', { status: 503 });
    });

    const result = await requestJson('https://x.test/a', {
      ...baseOptions,
      maxRetries: 2,
      fetch: fetchImpl,
    });

    // 1 initial + 2 retries, then the last response is returned as-is.
    expect(calls).toBe(3);
    expect(result.status).toBe(503);
  });

  // Authorization codes are single-use: a retried POST turns a transient blip
  // into a permanent `invalid_grant`.
  it('never retries a POST', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response('{}', { status: 500 });
    });

    await requestJson('https://x.test/token', {
      ...baseOptions,
      method: 'POST',
      form: { grant_type: 'authorization_code' },
      maxRetries: 5,
      fetch: fetchImpl,
    });

    expect(calls).toBe(1);
  });

  it('retries a 429', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('{}', { status: 429 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await requestJson('https://x.test/a', { ...baseOptions, fetch: fetchImpl });
    expect(calls).toBe(2);
  });

  it('does not retry a 400', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'bad' }), { status: 400 });
    });

    await requestJson('https://x.test/a', { ...baseOptions, fetch: fetchImpl });
    expect(calls).toBe(1);
  });

  it('form-encodes the body and sets the content type', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    await requestJson('https://x.test/token', {
      ...baseOptions,
      method: 'POST',
      form: { grant_type: 'authorization_code', code: 'abc def' },
      fetch: fetchImpl,
    });

    const init = fetchImpl.mock.calls[0]![1]!;
    expect(String(init.body)).toBe('grant_type=authorization_code&code=abc+def');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('reports a body that is not JSON', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>gateway error</html>', { status: 200 }),
    );

    await expect(
      requestJson('https://x.test/a', { ...baseOptions, fetch: fetchImpl }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('truncates the body preview in the error detail', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(10_000), { status: 200 }));

    try {
      await requestJson('https://x.test/a', { ...baseOptions, fetch: fetchImpl });
      throw new Error('should have thrown');
    } catch (error) {
      const preview = (error as { detail?: { bodyPreview?: string } }).detail?.bodyPreview ?? '';
      expect(preview.length).toBeLessThanOrEqual(120);
    }
  });

  it('reports a timeout distinctly from other network errors', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    await expect(
      requestJson('https://x.test/slow', {
        ...baseOptions,
        timeoutMs: 20,
        maxRetries: 0,
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('wraps a socket-level failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      requestJson('https://x.test/a', { ...baseOptions, maxRetries: 0, fetch: fetchImpl }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('sends an Accept header of application/json', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await requestJson('https://x.test/a', { ...baseOptions, fetch: fetchImpl });

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
  });
});
