/**
 * Test helpers: an in-process signing authority.
 *
 * These generate real RSA keys and real RS256 signatures, so the tests exercise
 * the same code path production does. Nothing here is mocked at the crypto
 * layer — a test suite that stubs signature verification cannot tell you whether
 * signature verification works.
 */

import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { DiscoveryDocument, JsonWebKeySet, KeslrIdTokenClaims } from '../../src/types.js';

export const TEST_ISSUER = 'https://id.keslr.test';
export const TEST_CLIENT_ID = 'keslr-test-client';
export const TEST_JWKS_URI = `${TEST_ISSUER}/oidc/jwks`;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface TestKey {
  kid: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

/** Generate an RSA keypair and its JWK representation. */
export function createTestKey(kid = 'test-key-1'): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const jwk = {
    ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
    kid,
    use: 'sig',
    alg: 'RS256',
  };

  return { kid, publicKey, privateKey, jwk };
}

/** Build a JWKS document from one or more test keys. */
export function toJwks(...keys: TestKey[]): JsonWebKeySet {
  return { keys: keys.map((key) => key.jwk) as JsonWebKeySet['keys'] };
}

export interface SignOptions {
  key: TestKey;
  claims: Partial<KeslrIdTokenClaims>;
  /** Override the `alg` header without changing how the token is actually signed. */
  algHeader?: string;
  /** Omit the `kid` header. */
  omitKid?: boolean;
  /** Replace the signature with garbage, keeping the structure valid. */
  corruptSignature?: boolean;
}

/**
 * Mint an ID token.
 *
 * Defaults produce a valid, currently-live token for a verified member; pass
 * `claims` to override any of them, including to invalid values.
 */
export function signIdToken(options: SignOptions): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const claims: KeslrIdTokenClaims = {
    iss: TEST_ISSUER,
    sub: '00000000-0000-4000-8000-000000000001',
    aud: TEST_CLIENT_ID,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    email: 'member@keslr.test',
    email_verified: true,
    name: 'Test Member',
    preferred_username: 'testmember',
    keslr_id: 'KID-TESTTESTTEST',
    verification_status: 'verified',
    verification_method: 'referral_approved',
    ...options.claims,
  } as KeslrIdTokenClaims;

  const header: Record<string, unknown> = {
    alg: options.algHeader ?? 'RS256',
    typ: 'JWT',
  };
  if (!options.omitKid) header.kid = options.key.kid;

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;

  if (options.corruptSignature) {
    return `${signingInput}.${base64Url(Buffer.alloc(256, 0x41))}`;
  }

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput, 'ascii');
  signer.end();

  return `${signingInput}.${base64Url(signer.sign(options.key.privateKey))}`;
}

/** Produce an `alg: "none"` token with an empty signature segment. */
export function forgeUnsignedToken(claims: Partial<KeslrIdTokenClaims> = {}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: TEST_ISSUER,
      sub: 'attacker',
      aud: TEST_CLIENT_ID,
      exp: nowSeconds + 3600,
      iat: nowSeconds,
      verification_status: 'verified',
      ...claims,
    }),
  );
  return `${header}.${payload}.`;
}

/** A discovery document pointing at the test issuer. */
export function testDiscoveryDocument(
  overrides: Partial<DiscoveryDocument> = {},
): DiscoveryDocument {
  return {
    issuer: TEST_ISSUER,
    authorization_endpoint: `${TEST_ISSUER}/oidc/authorize`,
    token_endpoint: `${TEST_ISSUER}/oidc/token`,
    jwks_uri: TEST_JWKS_URI,
    userinfo_endpoint: `${TEST_ISSUER}/oidc/userinfo`,
    end_session_endpoint: `${TEST_ISSUER}/oidc/logout`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    claims_supported: [
      'sub',
      'email',
      'email_verified',
      'name',
      'preferred_username',
      'keslr_id',
      'verification_status',
      'verification_method',
    ],
    ...overrides,
  };
}

export interface RouteMap {
  [url: string]:
    | { status?: number; body: unknown; delayMs?: number }
    | (() => { status?: number; body: unknown });
}

export interface MockFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  /** Every request made, in order. */
  calls: Array<{ url: string; init?: RequestInit }>;
  /** Count of requests to a given URL. */
  countFor(url: string): number;
}

/**
 * Build a `fetch` that serves a fixed route table.
 *
 * Requests to unmapped URLs resolve to 404 rather than throwing, so a test that
 * accidentally hits the network fails on an assertion rather than a timeout.
 */
export function createMockFetch(routes: RouteMap): MockFetch {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });

    const entry = routes[input];
    if (!entry) {
      return new Response(JSON.stringify({ error: 'not_found', url: input }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resolved = typeof entry === 'function' ? entry() : entry;
    if ('delayMs' in resolved && resolved.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, resolved.delayMs));
    }

    return new Response(
      typeof resolved.body === 'string' ? resolved.body : JSON.stringify(resolved.body),
      {
        status: resolved.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as MockFetch;

  fetchImpl.calls = calls;
  fetchImpl.countFor = (url: string) => calls.filter((call) => call.url === url).length;

  return fetchImpl;
}

/** A logger that records everything, for asserting on log behaviour. */
export function createRecordingLogger() {
  const records: Array<{ level: string; obj: Record<string, unknown>; msg?: string }> = [];
  const push =
    (level: string) =>
    (obj: Record<string, unknown>, msg?: string): void => {
      records.push({ level, obj, msg });
    };

  return {
    records,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}
