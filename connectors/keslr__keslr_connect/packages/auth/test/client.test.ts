/**
 * End-to-end tests for {@link KeslrAuthClient}, driven against a mock provider.
 */

import { describe, expect, it } from 'vitest';
import { KeslrAuthClient, resolveOptions } from '../src/client.js';
import { KeslrAuthError } from '../src/errors.js';
import {
  createMockFetch,
  createRecordingLogger,
  createTestKey,
  signIdToken,
  TEST_CLIENT_ID,
  TEST_ISSUER,
  TEST_JWKS_URI,
  testDiscoveryDocument,
  toJwks,
} from './helpers/keys.js';

const key = createTestKey();
const DISCOVERY_URL = `${TEST_ISSUER}/.well-known/openid-configuration`;
const TOKEN_URL = `${TEST_ISSUER}/oidc/token`;
const USERINFO_URL = `${TEST_ISSUER}/oidc/userinfo`;
const REDIRECT_URI = 'https://app.example/auth/keslr/callback';

function buildClient(
  overrides: Record<string, unknown> = {},
  routes: Record<string, unknown> = {},
) {
  const fetchImpl = createMockFetch({
    [DISCOVERY_URL]: { body: testDiscoveryDocument() },
    [TEST_JWKS_URI]: { body: toJwks(key) },
    ...routes,
  } as never);

  const client = new KeslrAuthClient({
    issuer: TEST_ISSUER,
    clientId: TEST_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    fetch: fetchImpl,
    ...overrides,
  });

  return { client, fetchImpl };
}

/** Mint a token, then wire a token endpoint that returns it. */
function tokenRoute(idToken: string, overrides: Record<string, unknown> = {}) {
  return {
    body: {
      access_token: 'access-token-value',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      scope: 'openid profile email',
      ...overrides,
    },
  };
}

describe('resolveOptions', () => {
  const valid = { issuer: TEST_ISSUER, clientId: 'c', redirectUri: 'https://app.example/cb' };

  it('applies defaults', () => {
    const resolved = resolveOptions(valid);
    expect(resolved.scopes).toEqual(['openid', 'profile', 'email']);
    expect(resolved.timeoutMs).toBe(10_000);
    expect(resolved.maxRetries).toBe(2);
    expect(resolved.clockToleranceSeconds).toBe(60);
  });

  it('strips a trailing slash from the issuer', () => {
    expect(resolveOptions({ ...valid, issuer: 'https://id.keslr.test/' }).issuer).toBe(
      'https://id.keslr.test',
    );
  });

  it.each([
    ['issuer', {}],
    ['clientId', { issuer: TEST_ISSUER }],
    ['redirectUri', { issuer: TEST_ISSUER, clientId: 'c' }],
  ])('requires %s', (_field, options) => {
    expect(() => resolveOptions(options as never)).toThrow(KeslrAuthError);
  });

  it('rejects a plaintext issuer outside localhost', () => {
    expect(() => resolveOptions({ ...valid, issuer: 'http://id.keslr.test' })).toThrow(/https/);
  });

  it('allows a plaintext issuer on localhost for development', () => {
    expect(() => resolveOptions({ ...valid, issuer: 'http://localhost:8002' })).not.toThrow();
  });

  it('rejects scopes that omit openid', () => {
    expect(() => resolveOptions({ ...valid, scopes: ['profile'] })).toThrow(/openid/);
  });

  it('rejects an absurd clock tolerance', () => {
    expect(() => resolveOptions({ ...valid, clockToleranceSeconds: 3600 })).toThrow(/NTP/);
  });

  it('rejects a relative redirectUri', () => {
    expect(() => resolveOptions({ ...valid, redirectUri: '/auth/callback' })).toThrow(
      /absolute URL/,
    );
  });
});

describe('createAuthorizationUrl', () => {
  it('builds a URL with every required parameter', async () => {
    const { client } = buildClient();
    const request = await client.createAuthorizationUrl();
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe(`${TEST_ISSUER}/oidc/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('nonce')).toBe(request.nonce);
  });

  it('never places the code verifier in the URL', async () => {
    const { client } = buildClient();
    const request = await client.createAuthorizationUrl();
    expect(request.url).not.toContain(request.codeVerifier);
  });

  it('generates a fresh state and nonce every call', async () => {
    const { client } = buildClient();
    const a = await client.createAuthorizationUrl();
    const b = await client.createAuthorizationUrl();

    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it('honours prompt, loginHint, and maxAge', async () => {
    const { client } = buildClient();
    const request = await client.createAuthorizationUrl({
      prompt: 'login',
      loginHint: 'member@keslr.test',
      maxAge: 300,
    });
    const url = new URL(request.url);

    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('login_hint')).toBe('member@keslr.test');
    expect(url.searchParams.get('max_age')).toBe('300');
  });

  it('rejects attempts to override reserved parameters', async () => {
    const { client } = buildClient();
    await expect(
      client.createAuthorizationUrl({ extraParams: { state: 'attacker-chosen' } }),
    ).rejects.toThrow(/reserved/);
  });

  it('caches discovery across calls', async () => {
    const { client, fetchImpl } = buildClient();
    await client.createAuthorizationUrl();
    await client.createAuthorizationUrl();
    await client.createAuthorizationUrl();

    expect(fetchImpl.countFor(DISCOVERY_URL)).toBe(1);
  });
});

describe('exchangeCode', () => {
  async function completeLogin(overrides: Record<string, unknown> = {}) {
    const nonce = 'fixed-nonce';
    const idToken = signIdToken({ key, claims: { nonce, ...(overrides.claims as object) } });
    const { client, fetchImpl } = buildClient(
      {},
      {
        [TOKEN_URL]: tokenRoute(idToken),
        [USERINFO_URL]: {
          body: {
            sub: '00000000-0000-4000-8000-000000000001',
            keslr_id: 'KID-TESTTESTTEST',
            verification_status: 'verified',
            name: 'Test Member',
          },
        },
      },
    );

    const result = await client.exchangeCode({
      params: { code: 'auth-code', state: 'expected-state' },
      expectedState: 'expected-state',
      expectedNonce: nonce,
      codeVerifier: 'a'.repeat(43),
      ...overrides,
    } as never);

    return { result, fetchImpl };
  }

  it('returns a normalised, verified user', async () => {
    const { result } = await completeLogin();

    expect(result.user.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.user.keslrId).toBe('KID-TESTTESTTEST');
    expect(result.user.isVerified).toBe(true);
    expect(result.user.verificationStatus).toBe('verified');
    expect(result.accessToken).toBe('access-token-value');
    expect(result.scopes).toEqual(['openid', 'profile', 'email']);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('sends the PKCE verifier to the token endpoint', async () => {
    const { fetchImpl } = await completeLogin();
    const tokenCall = fetchImpl.calls.find((call) => call.url === TOKEN_URL);
    const body = String(tokenCall?.init?.body);

    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code_verifier=');
  });

  it('rejects a mismatched state before contacting the token endpoint', async () => {
    const { client, fetchImpl } = buildClient({}, { [TOKEN_URL]: tokenRoute('unused') });

    await expect(
      client.exchangeCode({
        params: { code: 'auth-code', state: 'attacker-state' },
        expectedState: 'expected-state',
        expectedNonce: 'n',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'state_mismatch' });

    // The important assertion: no code was redeemed.
    expect(fetchImpl.countFor(TOKEN_URL)).toBe(0);
  });

  it('surfaces an OAuth error from the authorization response', async () => {
    const { client } = buildClient();

    await expect(
      client.exchangeCode({
        params: { error: 'access_denied', error_description: 'Member cancelled' },
        expectedState: 's',
        expectedNonce: 'n',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'provider_error', oauthError: 'access_denied' });
  });

  it('surfaces an OAuth error from the token endpoint', async () => {
    const { client } = buildClient(
      {},
      {
        [TOKEN_URL]: {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'Authorization code expired' },
        },
      },
    );

    await expect(
      client.exchangeCode({
        params: { code: 'stale', state: 's' },
        expectedState: 's',
        expectedNonce: 'n',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'provider_error', oauthError: 'invalid_grant' });
  });

  it('rejects an ID token whose nonce does not match', async () => {
    const idToken = signIdToken({ key, claims: { nonce: 'a-different-nonce' } });
    const { client } = buildClient({}, { [TOKEN_URL]: tokenRoute(idToken) });

    await expect(
      client.exchangeCode({
        params: { code: 'c', state: 's' },
        expectedState: 's',
        expectedNonce: 'the-real-nonce',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'nonce_mismatch' });
  });

  it('rejects a token response with a non-Bearer token_type', async () => {
    const idToken = signIdToken({ key, claims: { nonce: 'n' } });
    const { client } = buildClient({}, { [TOKEN_URL]: tokenRoute(idToken, { token_type: 'mac' }) });

    await expect(
      client.exchangeCode({
        params: { code: 'c', state: 's' },
        expectedState: 's',
        expectedNonce: 'n',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'token_response_invalid' });
  });

  it('rejects a UserInfo response for a different subject', async () => {
    const idToken = signIdToken({ key, claims: { nonce: 'n' } });
    const { client } = buildClient(
      {},
      {
        [TOKEN_URL]: tokenRoute(idToken),
        [USERINFO_URL]: { body: { sub: 'someone-else', verification_status: 'verified' } },
      },
    );

    await expect(
      client.exchangeCode({
        params: { code: 'c', state: 's' },
        expectedState: 's',
        expectedNonce: 'n',
        codeVerifier: 'a'.repeat(43),
      }),
    ).rejects.toThrow(/does not match ID token subject/);
  });

  it('skips UserInfo when asked to', async () => {
    const idToken = signIdToken({ key, claims: { nonce: 'n' } });
    const { client, fetchImpl } = buildClient({}, { [TOKEN_URL]: tokenRoute(idToken) });

    await client.exchangeCode({
      params: { code: 'c', state: 's' },
      expectedState: 's',
      expectedNonce: 'n',
      codeVerifier: 'a'.repeat(43),
      fetchUserInfo: false,
    });

    expect(fetchImpl.countFor(USERINFO_URL)).toBe(0);
  });

  it('marks an unverified member as not verified rather than failing', async () => {
    const idToken = signIdToken({
      key,
      claims: { nonce: 'n', verification_status: 'pending_verification' },
    });
    const { client } = buildClient({}, { [TOKEN_URL]: tokenRoute(idToken) });

    const result = await client.exchangeCode({
      params: { code: 'c', state: 's' },
      expectedState: 's',
      expectedNonce: 'n',
      codeVerifier: 'a'.repeat(43),
      fetchUserInfo: false,
    });

    expect(result.user.isVerified).toBe(false);
    expect(result.user.verificationStatus).toBe('pending_verification');
  });

  it('never logs the access token', async () => {
    const logger = createRecordingLogger();
    const idToken = signIdToken({ key, claims: { nonce: 'n' } });
    const { client } = buildClient({ logger }, { [TOKEN_URL]: tokenRoute(idToken) });

    await client.exchangeCode({
      params: { code: 'c', state: 's' },
      expectedState: 's',
      expectedNonce: 'n',
      codeVerifier: 'a'.repeat(43),
      fetchUserInfo: false,
    });

    const serialised = JSON.stringify(logger.records);
    expect(serialised).not.toContain('access-token-value');
    expect(serialised).not.toContain(idToken);
  });
});

describe('createLogoutUrl', () => {
  it('builds an end-session URL', async () => {
    const { client } = buildClient();
    const url = await client.createLogoutUrl({
      idTokenHint: 'the-id-token',
      postLogoutRedirectUri: 'https://app.example/',
    });

    const parsed = new URL(url!);
    expect(parsed.searchParams.get('id_token_hint')).toBe('the-id-token');
    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example/');
    expect(parsed.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
  });

  it('returns null when the provider advertises no end_session_endpoint', async () => {
    const doc = testDiscoveryDocument();
    delete doc.end_session_endpoint;
    const { client } = buildClient({}, { [DISCOVERY_URL]: { body: doc } });

    expect(await client.createLogoutUrl()).toBeNull();
  });
});

describe('isConfidential', () => {
  it('is false without a client secret', () => {
    const { client } = buildClient();
    expect(client.isConfidential).toBe(false);
  });

  it('is true with a client secret', () => {
    const { client } = buildClient({ clientSecret: 'shh' });
    expect(client.isConfidential).toBe(true);
  });
});
