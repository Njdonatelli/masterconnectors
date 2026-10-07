import { describe, expect, it, vi } from 'vitest';
import { IdentityLookup } from '../src/lookup.js';

const BASE_URL = 'https://api.keslr.test';

/**
 * A mapping in the exact shape the API returns it: flat, no envelope, no
 * `keslr_id`. Matching the real response is the point of these tests — a fixture
 * that invents a nicer shape tests nothing but the fixture.
 */
function member(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-uuid-1',
    username: 'testmember',
    node_id: 'node-1',
    online: true,
    last_seen: '2026-08-07T12:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('IdentityLookup.resolve', () => {
  it('resolves an address to a member', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    const identity = await lookup.resolve('100.64.0.1');

    expect(identity).toMatchObject({
      userId: 'user-uuid-1',
      username: 'testmember',
      nodeId: 'node-1',
      address: '100.64.0.1',
      online: true,
    });
    expect(identity?.lastSeen).toBeInstanceOf(Date);
  });

  it('returns null for an address with no owner', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'IP not found.' }, 404));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    expect(await lookup.resolve('203.0.113.1')).toBeNull();
  });

  it('treats a 404 as no owner rather than an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'not found' }, 404));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    expect(await lookup.resolve('203.0.113.1')).toBeNull();
  });

  it('caches a positive result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolve('100.64.0.1');
    await lookup.resolve('100.64.0.1');
    await lookup.resolve('100.64.0.1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Otherwise a scanner hitting the service repeatedly amplifies into one API
  // call per request.
  it('caches a negative result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'IP not found.' }, 404));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolve('203.0.113.1');
    await lookup.resolve('203.0.113.1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl, cacheTtlMs: 10 });

    await lookup.resolve('100.64.0.1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await lookup.resolve('100.64.0.1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent lookups for the same address', async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({ ...member(), ip: '100.64.0.1' });
    });
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await Promise.all([
      lookup.resolve('100.64.0.1'),
      lookup.resolve('100.64.0.1'),
      lookup.resolve('100.64.0.1'),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends Basic credentials when configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({
      baseUrl: BASE_URL,
      clientId: 'client',
      clientSecret: 'secret',
      fetch: fetchImpl,
    });

    await lookup.resolve('100.64.0.1');

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`);
  });

  it('reports unauthorized distinctly, since it is a configuration problem', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await expect(lookup.resolve('100.64.0.1')).rejects.toMatchObject({
      code: 'lookup_unauthorized',
    });
  });

  it('reports a 500 as a lookup failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await expect(lookup.resolve('100.64.0.1')).rejects.toMatchObject({ code: 'lookup_failed' });
  });

  it('discards a zero-value last_seen rather than dating it to year 1', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...member({ last_seen: '0001-01-01T00:00:00Z' }), ip: '100.64.0.1' }),
    );
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    expect((await lookup.resolve('100.64.0.1'))?.lastSeen).toBeUndefined();
  });

  it('treats a body with no user_id as no mapping', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    expect(await lookup.resolve('100.64.0.1')).toBeNull();
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: `${BASE_URL}/`, fetch: fetchImpl });

    await lookup.resolve('100.64.0.1');

    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/api/network/ip-lookup?ip=100.64.0.1`);
  });
});

describe('IdentityLookup.resolveMany', () => {
  it('resolves a batch in one request', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: {
          '100.64.0.1': member(),
          '100.64.0.2': member({ user_id: 'user-uuid-2', username: 'other' }),
          '100.64.0.3': null,
        },
      }),
    );
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    const result = await lookup.resolveMany(['100.64.0.1', '100.64.0.2', '100.64.0.3']);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result['100.64.0.1']?.username).toBe('testmember');
    expect(result['100.64.0.2']?.username).toBe('other');
    expect(result['100.64.0.3']).toBeNull();
  });

  it('serves cached entries without including them in the request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...member(), ip: '100.64.0.1' }))
      .mockResolvedValueOnce(
        jsonResponse({ results: { '100.64.0.2': member({ username: 'other' }) } }),
      );

    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolve('100.64.0.1');
    await lookup.resolveMany(['100.64.0.1', '100.64.0.2']);

    const bulkBody = JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body));
    expect(bulkBody.ips).toEqual(['100.64.0.2']);
  });

  it('deduplicates the input', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: { '100.64.0.1': member() } }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolveMany(['100.64.0.1', '100.64.0.1', '100.64.0.1']);

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).ips).toEqual(['100.64.0.1']);
  });

  it('chunks requests above the API ceiling of 500', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: {} }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    const addresses = Array.from(
      { length: 1200 },
      (_, i) => `100.64.${Math.floor(i / 256)}.${i % 256}`,
    );
    await lookup.resolveMany(addresses);

    // 500 + 500 + 200
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('sends one request for a batch inside the ceiling', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: {} }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolveMany(Array.from({ length: 400 }, (_, i) => `100.64.2.${i % 256}-${i}`));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('IdentityLookup cache management', () => {
  it('bounds the cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl, maxCacheEntries: 5 });

    for (let i = 0; i < 50; i++) await lookup.resolve(`100.64.2.${i}`);

    expect(lookup.cacheSize()).toBeLessThanOrEqual(5);
  });

  it('clearCache empties it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...member(), ip: '100.64.0.1' }));
    const lookup = new IdentityLookup({ baseUrl: BASE_URL, fetch: fetchImpl });

    await lookup.resolve('100.64.0.1');
    lookup.clearCache();

    expect(lookup.cacheSize()).toBe(0);
  });
});
