import { describe, expect, it } from 'vitest';
import {
  assertValidDiscoveryDocument,
  buildDiscoveryUrl,
  DiscoveryCache,
} from '../src/discovery.js';
import { noopLogger } from '../src/logger.js';
import { createMockFetch, TEST_ISSUER, testDiscoveryDocument } from './helpers/keys.js';

const DISCOVERY_URL = `${TEST_ISSUER}/.well-known/openid-configuration`;

function buildCache(routes: Record<string, unknown>, issuer = TEST_ISSUER) {
  const fetchImpl = createMockFetch(routes as never);
  const cache = new DiscoveryCache({
    issuer,
    timeoutMs: 1000,
    maxRetries: 0,
    cacheTtlMs: 60_000,
    fetch: fetchImpl,
    logger: noopLogger,
  });
  return { cache, fetchImpl };
}

describe('buildDiscoveryUrl', () => {
  it('appends the well-known path', () => {
    expect(buildDiscoveryUrl('https://api.keslr.com')).toBe(
      'https://api.keslr.com/.well-known/openid-configuration',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(buildDiscoveryUrl('https://api.keslr.com/')).toBe(
      'https://api.keslr.com/.well-known/openid-configuration',
    );
  });

  it('preserves a path component', () => {
    expect(buildDiscoveryUrl('https://api.keslr.com/tenant/a')).toBe(
      'https://api.keslr.com/tenant/a/.well-known/openid-configuration',
    );
  });
});

describe('DiscoveryCache', () => {
  it('fetches and returns the document', async () => {
    const { cache } = buildCache({ [DISCOVERY_URL]: { body: testDiscoveryDocument() } });
    const document = await cache.get();
    expect(document.issuer).toBe(TEST_ISSUER);
    expect(document.token_endpoint).toBe(`${TEST_ISSUER}/oidc/token`);
  });

  it('caches across calls', async () => {
    const { cache, fetchImpl } = buildCache({ [DISCOVERY_URL]: { body: testDiscoveryDocument() } });

    await cache.get();
    await cache.get();

    expect(fetchImpl.countFor(DISCOVERY_URL)).toBe(1);
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const { cache, fetchImpl } = buildCache({
      [DISCOVERY_URL]: { body: testDiscoveryDocument(), delayMs: 20 },
    });

    await Promise.all([cache.get(), cache.get(), cache.get(), cache.get()]);

    expect(fetchImpl.countFor(DISCOVERY_URL)).toBe(1);
  });

  it('refetches after invalidation', async () => {
    const { cache, fetchImpl } = buildCache({ [DISCOVERY_URL]: { body: testDiscoveryDocument() } });

    await cache.get();
    cache.invalidate();
    await cache.get();

    expect(fetchImpl.countFor(DISCOVERY_URL)).toBe(2);
  });

  it('reports a non-200 response', async () => {
    const { cache } = buildCache({ [DISCOVERY_URL]: { status: 500, body: {} } });
    await expect(cache.get()).rejects.toMatchObject({ code: 'discovery_failed' });
  });

  it('can be seeded for offline use', async () => {
    const { cache, fetchImpl } = buildCache({});
    cache.seed(testDiscoveryDocument());

    await expect(cache.get()).resolves.toBeDefined();
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('assertValidDiscoveryDocument', () => {
  it('accepts a complete document', () => {
    expect(() => assertValidDiscoveryDocument(testDiscoveryDocument(), TEST_ISSUER)).not.toThrow();
  });

  it.each(['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'])(
    'rejects a document missing %s',
    (field) => {
      const document = testDiscoveryDocument() as Record<string, unknown>;
      delete document[field];
      expect(() => assertValidDiscoveryDocument(document, TEST_ISSUER)).toThrow(/required/);
    },
  );

  // OIDC Discovery §4.3. Without this, a provider could impersonate another.
  it('rejects a document whose issuer does not match where it was fetched from', () => {
    const document = testDiscoveryDocument({ issuer: 'https://evil.example' });
    expect(() => assertValidDiscoveryDocument(document, TEST_ISSUER)).toThrow(/issuer mismatch/);
  });

  it('tolerates a trailing-slash difference in the issuer', () => {
    const document = testDiscoveryDocument({ issuer: `${TEST_ISSUER}/` });
    expect(() => assertValidDiscoveryDocument(document, TEST_ISSUER)).not.toThrow();
  });

  it('rejects a plaintext endpoint on a public host', () => {
    const document = testDiscoveryDocument({ token_endpoint: 'http://id.keslr.test/oidc/token' });
    expect(() => assertValidDiscoveryDocument(document, TEST_ISSUER)).toThrow(/https/);
  });

  it('allows plaintext endpoints on loopback for local development', () => {
    const document = testDiscoveryDocument({
      issuer: 'http://localhost:8002',
      authorization_endpoint: 'http://localhost:8002/oidc/authorize',
      token_endpoint: 'http://localhost:8002/oidc/token',
      jwks_uri: 'http://localhost:8002/oidc/jwks',
    });
    expect(() => assertValidDiscoveryDocument(document, 'http://localhost:8002')).not.toThrow();
  });

  it('rejects a relative endpoint URL', () => {
    const document = testDiscoveryDocument({ jwks_uri: '/oidc/jwks' });
    expect(() => assertValidDiscoveryDocument(document, TEST_ISSUER)).toThrow(/absolute URL/);
  });

  it.each([[null], [42], ['a string'], [[]]])('rejects the non-object %s', (value) => {
    expect(() => assertValidDiscoveryDocument(value, TEST_ISSUER)).toThrow();
  });
});
