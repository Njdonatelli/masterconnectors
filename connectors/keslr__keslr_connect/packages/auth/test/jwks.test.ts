import { describe, expect, it, vi } from 'vitest';
import { isUsableSigningKey, JwksCache, JWKS_REFRESH_COOLDOWN_MS } from '../src/jwks.js';
import { noopLogger } from '../src/logger.js';
import { createMockFetch, createTestKey, TEST_JWKS_URI, toJwks } from './helpers/keys.js';

const keyA = createTestKey('key-a');
const keyB = createTestKey('key-b');

function buildCache(routes: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const fetchImpl = createMockFetch(routes as never);
  const cache = new JwksCache(TEST_JWKS_URI, {
    timeoutMs: 1000,
    maxRetries: 0,
    cacheTtlMs: 60_000,
    fetch: fetchImpl,
    logger: noopLogger,
    ...overrides,
  } as never);
  return { cache, fetchImpl };
}

describe('JwksCache', () => {
  it('resolves a key by kid', async () => {
    const { cache } = buildCache({ [TEST_JWKS_URI]: { body: toJwks(keyA, keyB) } });
    const key = await cache.getKey('key-a');
    expect(key.asymmetricKeyType).toBe('rsa');
  });

  it('fetches only once for repeated resolutions', async () => {
    const { cache, fetchImpl } = buildCache({ [TEST_JWKS_URI]: { body: toJwks(keyA) } });

    await cache.getKey('key-a');
    await cache.getKey('key-a');
    await cache.getKey('key-a');

    expect(fetchImpl.countFor(TEST_JWKS_URI)).toBe(1);
  });

  it('shares a single in-flight fetch between concurrent callers', async () => {
    const { cache, fetchImpl } = buildCache({
      [TEST_JWKS_URI]: { body: toJwks(keyA), delayMs: 20 },
    });

    await Promise.all([cache.getKey('key-a'), cache.getKey('key-a'), cache.getKey('key-a')]);

    expect(fetchImpl.countFor(TEST_JWKS_URI)).toBe(1);
  });

  it('refetches once when a kid is missing, to pick up a rotated key', async () => {
    let served = toJwks(keyA);
    const fetchImpl = createMockFetch({
      [TEST_JWKS_URI]: () => ({ body: served }),
    } as never);

    const cache = new JwksCache(TEST_JWKS_URI, {
      timeoutMs: 1000,
      maxRetries: 0,
      cacheTtlMs: 60_000,
      fetch: fetchImpl,
      logger: noopLogger,
    });

    await cache.getKey('key-a');
    expect(fetchImpl.countFor(TEST_JWKS_URI)).toBe(1);

    // Keslr rotates: key-b appears.
    served = toJwks(keyA, keyB);
    vi.setSystemTime(Date.now() + JWKS_REFRESH_COOLDOWN_MS + 1000);

    const rotated = await cache.getKey('key-b');
    expect(rotated.asymmetricKeyType).toBe('rsa');
    expect(fetchImpl.countFor(TEST_JWKS_URI)).toBe(2);

    vi.useRealTimers();
  });

  it('does not refetch repeatedly for unknown kids within the cooldown', async () => {
    const { cache, fetchImpl } = buildCache({ [TEST_JWKS_URI]: { body: toJwks(keyA) } });

    await cache.getKey('key-a');
    const baseline = fetchImpl.countFor(TEST_JWKS_URI);

    // An attacker sends tokens with random kids. Each miss must not become an
    // outbound request, or the endpoint becomes an amplification vector.
    for (let i = 0; i < 25; i++) {
      await expect(cache.getKey(`bogus-${i}`)).rejects.toMatchObject({
        code: 'jwks_key_not_found',
      });
    }

    // At most one extra fetch — the first miss, before the cooldown engaged.
    expect(fetchImpl.countFor(TEST_JWKS_URI)).toBeLessThanOrEqual(baseline + 1);
  });

  it('accepts a token with no kid when exactly one key is published', async () => {
    const { cache } = buildCache({ [TEST_JWKS_URI]: { body: toJwks(keyA) } });
    await expect(cache.getKey(undefined)).resolves.toBeDefined();
  });

  it('rejects a token with no kid when several keys are published', async () => {
    const { cache } = buildCache({ [TEST_JWKS_URI]: { body: toJwks(keyA, keyB) } });
    await expect(cache.getKey(undefined)).rejects.toMatchObject({ code: 'jwks_key_not_found' });
  });

  it('reports a non-200 JWKS response', async () => {
    const { cache } = buildCache({ [TEST_JWKS_URI]: { status: 503, body: {} } });
    await expect(cache.getKey('key-a')).rejects.toMatchObject({ code: 'jwks_fetch_failed' });
  });

  it('rejects a response with no keys array', async () => {
    const { cache } = buildCache({ [TEST_JWKS_URI]: { body: { nope: true } } });
    await expect(cache.getKey('key-a')).rejects.toMatchObject({ code: 'jwks_invalid' });
  });

  it('rejects a key set containing no usable signing keys', async () => {
    const { cache } = buildCache({
      [TEST_JWKS_URI]: { body: { keys: [{ kty: 'oct', k: 'secret' }] } },
    });
    await expect(cache.getKey('anything')).rejects.toMatchObject({ code: 'jwks_invalid' });
  });

  it('skips unusable keys but keeps usable ones', async () => {
    const { cache } = buildCache({
      [TEST_JWKS_URI]: {
        body: { keys: [{ kty: 'EC', crv: 'P-256', kid: 'ec-key' }, keyA.jwk] },
      },
    });

    await expect(cache.getKey('key-a')).resolves.toBeDefined();
    expect(cache.size()).toBe(1);
  });

  it('can be seeded without a network call', async () => {
    const { cache, fetchImpl } = buildCache({});
    cache.seed(toJwks(keyA));

    await expect(cache.getKey('key-a')).resolves.toBeDefined();
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('isUsableSigningKey', () => {
  it('accepts an RSA key with no use or alg', () => {
    expect(isUsableSigningKey({ kty: 'RSA', n: 'x', e: 'AQAB' })).toBe(true);
  });

  it('accepts an RSA key marked for signing', () => {
    expect(isUsableSigningKey({ kty: 'RSA', use: 'sig', alg: 'RS256', n: 'x', e: 'AQAB' })).toBe(
      true,
    );
  });

  it('rejects a key marked for encryption', () => {
    expect(isUsableSigningKey({ kty: 'RSA', use: 'enc', n: 'x', e: 'AQAB' })).toBe(false);
  });

  it('rejects a non-RSA key type', () => {
    expect(isUsableSigningKey({ kty: 'EC', n: 'x', e: 'AQAB' })).toBe(false);
  });

  it('rejects an RSA key declaring a different algorithm', () => {
    expect(isUsableSigningKey({ kty: 'RSA', alg: 'RS512', n: 'x', e: 'AQAB' })).toBe(false);
  });

  it('rejects an RSA key missing its modulus', () => {
    expect(isUsableSigningKey({ kty: 'RSA', e: 'AQAB' })).toBe(false);
  });
});
