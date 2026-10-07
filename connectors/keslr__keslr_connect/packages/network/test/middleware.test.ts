import { describe, expect, it, vi } from 'vitest';
import {
  extractClientAddress,
  keslrNetworkIdentity,
  normalizeAddress,
  requireNetworkIdentity,
  type MinimalRequest,
  type MinimalResponse,
} from '../src/middleware.js';
import type { IdentityLookup } from '../src/lookup.js';
import type { NetworkIdentity } from '../src/types.js';

const identity: NetworkIdentity = {
  userId: 'user-uuid',
  keslrId: 'KID-ABCDEFGHIJKL',
  username: 'testmember',
  address: '100.64.0.1',
};

function fakeLookup(resolve: (address: string) => Promise<NetworkIdentity | null>): IdentityLookup {
  return { resolve } as unknown as IdentityLookup;
}

function fakeRequest(overrides: Partial<MinimalRequest> = {}): MinimalRequest {
  return { headers: {}, socket: { remoteAddress: '100.64.0.1' }, ...overrides };
}

function fakeResponse(): MinimalResponse & { statusCode?: number; body?: unknown } {
  const res: MinimalResponse & { statusCode?: number; body?: unknown } = {
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return body;
    },
  };
  return res;
}

describe('normalizeAddress', () => {
  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(normalizeAddress('::ffff:100.64.0.1')).toBe('100.64.0.1');
  });

  it('strips a zone identifier', () => {
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
  });

  it('trims whitespace', () => {
    expect(normalizeAddress('  100.64.0.1  ')).toBe('100.64.0.1');
  });

  it('leaves a plain IPv4 address alone', () => {
    expect(normalizeAddress('100.64.0.1')).toBe('100.64.0.1');
  });
});

describe('extractClientAddress', () => {
  it('uses req.ip when present', () => {
    expect(extractClientAddress(fakeRequest({ ip: '100.64.0.9' }), false)).toBe('100.64.0.9');
  });

  it('falls back to the socket address', () => {
    expect(extractClientAddress(fakeRequest(), false)).toBe('100.64.0.1');
  });

  // The default matters: a forwarded header is client-supplied.
  it('ignores X-Forwarded-For unless trustProxy is set', () => {
    const req = fakeRequest({ headers: { 'x-forwarded-for': '100.64.0.99' } });
    expect(extractClientAddress(req, false)).toBe('100.64.0.1');
  });

  it('uses X-Forwarded-For when trustProxy is set', () => {
    const req = fakeRequest({ headers: { 'x-forwarded-for': '100.64.0.99' } });
    expect(extractClientAddress(req, true)).toBe('100.64.0.99');
  });

  it('takes the left-most entry of a forwarded chain', () => {
    const req = fakeRequest({ headers: { 'x-forwarded-for': '100.64.0.99, 10.0.0.1, 10.0.0.2' } });
    expect(extractClientAddress(req, true)).toBe('100.64.0.99');
  });

  it('returns undefined when there is no address at all', () => {
    expect(extractClientAddress({ headers: {} }, false)).toBeUndefined();
  });
});

describe('keslrNetworkIdentity', () => {
  it('attaches the resolved identity', async () => {
    const middleware = keslrNetworkIdentity({ lookup: fakeLookup(async () => identity) });
    const req = fakeRequest();
    const next = vi.fn();

    await middleware(req, fakeResponse(), next);

    expect(req.keslrNetwork).toEqual(identity);
    expect(next).toHaveBeenCalledWith();
  });

  it('attaches null for an unknown address and continues', async () => {
    const middleware = keslrNetworkIdentity({ lookup: fakeLookup(async () => null) });
    const req = fakeRequest({ socket: { remoteAddress: '203.0.113.1' } });
    const next = vi.fn();

    await middleware(req, fakeResponse(), next);

    expect(req.keslrNetwork).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects an unknown address in strict mode', async () => {
    const middleware = keslrNetworkIdentity({
      lookup: fakeLookup(async () => null),
      strict: true,
    });
    const next = vi.fn();

    await middleware(fakeRequest(), fakeResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'identity_unknown' }));
  });

  it('normalises an IPv4-mapped address before lookup', async () => {
    const resolve = vi.fn(async () => identity);
    const middleware = keslrNetworkIdentity({ lookup: fakeLookup(resolve) });

    await middleware(
      fakeRequest({ socket: { remoteAddress: '::ffff:100.64.0.1' } }),
      fakeResponse(),
      vi.fn(),
    );

    expect(resolve).toHaveBeenCalledWith('100.64.0.1');
  });

  // A lookup outage should not take the whole service down.
  it('fails open on a lookup error in non-strict mode', async () => {
    const middleware = keslrNetworkIdentity({
      lookup: fakeLookup(async () => {
        throw new Error('lookup API down');
      }),
    });
    const req = fakeRequest();
    const next = vi.fn();

    await middleware(req, fakeResponse(), next);

    expect(req.keslrNetwork).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  it('fails closed on a lookup error in strict mode', async () => {
    const boom = new Error('lookup API down');
    const middleware = keslrNetworkIdentity({
      lookup: fakeLookup(async () => {
        throw boom;
      }),
      strict: true,
    });
    const next = vi.fn();

    await middleware(fakeRequest(), fakeResponse(), next);

    expect(next).toHaveBeenCalledWith(boom);
  });

  it('reports lookup errors through onLookupError', async () => {
    const onLookupError = vi.fn();
    const middleware = keslrNetworkIdentity({
      lookup: fakeLookup(async () => {
        throw new Error('boom');
      }),
      onLookupError,
    });

    await middleware(fakeRequest(), fakeResponse(), vi.fn());

    expect(onLookupError).toHaveBeenCalledWith(expect.any(Error), '100.64.0.1');
  });

  it('handles a request with no address', async () => {
    const middleware = keslrNetworkIdentity({ lookup: fakeLookup(async () => identity) });
    const req: MinimalRequest = { headers: {} };
    const next = vi.fn();

    await middleware(req, fakeResponse(), next);

    expect(req.keslrNetwork).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireNetworkIdentity', () => {
  it('passes a request with an identity through', () => {
    const next = vi.fn();
    requireNetworkIdentity()(fakeRequest({ keslrNetwork: identity }), fakeResponse(), next);
    expect(next).toHaveBeenCalled();
  });

  it('responds 403 when there is no identity', () => {
    const res = fakeResponse();
    const next = vi.fn();

    requireNetworkIdentity()(fakeRequest({ keslrNetwork: null }), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'not_a_keslr_member' });
    expect(next).not.toHaveBeenCalled();
  });
});
