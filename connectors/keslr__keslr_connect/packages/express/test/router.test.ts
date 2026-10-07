/**
 * Router tests: the full login flow through a real Express app.
 *
 * A real `express()` instance on a real ephemeral port, driven with `fetch`.
 * The only thing faked is Keslr itself — a stub provider that serves discovery,
 * JWKS, token, and userinfo, and signs tokens with a genuine RSA key.
 *
 * Testing the router with mocked HTTP would prove nothing about whether the
 * routes are mounted, whether cookies survive the redirect, or whether the
 * session store behaves. Those are exactly the things that break.
 */

import { createServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import session from 'express-session';
import { keslrAuth } from '../src/index.js';

// ---------------------------------------------------------------------------
// A stub Keslr provider
// ---------------------------------------------------------------------------

const KID = 'stub-key-1';
const CLIENT_ID = 'stub-client';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

interface StubProvider {
  issuer: string;
  server: Server;
  /** Claims merged into the next issued ID token. */
  nextClaims: Record<string, unknown>;
  /** Force the token endpoint to return this OAuth error. */
  tokenError?: { error: string; error_description?: string };
  /** The nonce the provider will echo. Defaults to the one requested. */
  lastNonce?: string;
  close(): Promise<void>;
}

async function startStubProvider(): Promise<StubProvider> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const state: StubProvider = {
    issuer: '',
    server: undefined as never,
    nextClaims: {},
    close: async () => undefined,
  };

  const sign = (claims: Record<string, unknown>, key: KeyObject): string => {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
    const payload = base64Url(JSON.stringify(claims));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`, 'ascii');
    signer.end();
    return `${header}.${payload}.${base64Url(signer.sign(key))}`;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', state.issuer);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      json(200, {
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/oidc/authorize`,
        token_endpoint: `${state.issuer}/oidc/token`,
        jwks_uri: `${state.issuer}/oidc/jwks`,
        userinfo_endpoint: `${state.issuer}/oidc/userinfo`,
        end_session_endpoint: `${state.issuer}/oidc/logout`,
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
      return;
    }

    if (url.pathname === '/oidc/jwks') {
      json(200, {
        keys: [
          {
            ...(publicKey.export({ format: 'jwk' }) as object),
            kid: KID,
            use: 'sig',
            alg: 'RS256',
          },
        ],
      });
      return;
    }

    if (url.pathname === '/oidc/token') {
      if (state.tokenError) {
        json(400, state.tokenError);
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const idToken = sign(
        {
          iss: state.issuer,
          sub: 'member-uuid-1',
          aud: CLIENT_ID,
          exp: now + 3600,
          iat: now,
          nonce: state.lastNonce,
          email: 'member@keslr.test',
          email_verified: true,
          name: 'Test Member',
          preferred_username: 'testmember',
          keslr_id: 'KID-STUBSTUBSTUB',
          verification_status: 'verified',
          verification_method: 'referral_approved',
          ...state.nextClaims,
        },
        privateKey,
      );

      json(200, {
        access_token: 'stub-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
        scope: 'openid profile email',
      });
      return;
    }

    if (url.pathname === '/oidc/userinfo') {
      json(200, {
        sub: 'member-uuid-1',
        keslr_id: 'KID-STUBSTUBSTUB',
        preferred_username: 'testmember',
        verification_status: state.nextClaims.verification_status ?? 'verified',
      });
      return;
    }

    json(404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  state.issuer = `http://127.0.0.1:${port}`;
  state.server = server;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  return state;
}

// ---------------------------------------------------------------------------
// The application under test
// ---------------------------------------------------------------------------

interface App {
  baseUrl: string;
  server: Server;
  close(): Promise<void>;
}

async function startApp(
  provider: StubProvider,
  overrides: Record<string, unknown> = {},
): Promise<App> {
  const app: Express = express();

  app.use(
    session({
      secret: 'test-secret-not-for-production',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: false },
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  app.use(
    keslrAuth({
      issuer: provider.issuer,
      clientId: CLIENT_ID,
      clientSecret: 'stub-secret',
      redirectUri: `${baseUrl}/auth/keslr/callback`,
      ...overrides,
    }),
  );

  app.get('/me', (req, res) => {
    res.json(
      req.keslr ? { username: req.keslr.user.username, verified: req.keslr.user.isVerified } : null,
    );
  });

  return {
    baseUrl,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A fetch that carries cookies, like a browser. */
function createCookieJar() {
  let cookie = '';

  return async function jarFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
    }

    return response;
  };
}

// ---------------------------------------------------------------------------

describe('keslrAuth router', () => {
  let provider: StubProvider;
  let app: App;

  beforeAll(async () => {
    provider = await startStubProvider();
  });

  afterAll(async () => {
    await provider.close();
  });

  afterEach(async () => {
    provider.nextClaims = {};
    provider.tokenError = undefined;
    await app?.close();
  });

  /** Drive a full login and return the cookie jar plus the final redirect. */
  async function login(jar = createCookieJar()): Promise<{ jar: typeof jar; location: string }> {
    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login`);
    expect(loginResponse.status).toBe(302);

    const authorizeUrl = new URL(loginResponse.headers.get('location')!);
    provider.lastNonce = authorizeUrl.searchParams.get('nonce') ?? undefined;
    const state = authorizeUrl.searchParams.get('state')!;

    const callback = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=stub-code&state=${encodeURIComponent(state)}`,
    );

    return { jar, location: callback.headers.get('location') ?? '' };
  }

  it('redirects to the provider on /login with all required parameters', async () => {
    app = await startApp(provider);
    const response = await createCookieJar()(`${app.baseUrl}/auth/keslr/login`);

    expect(response.status).toBe(302);
    const url = new URL(response.headers.get('location')!);

    expect(url.pathname).toBe('/oidc/authorize');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
  });

  it('completes a login and attaches the member to subsequent requests', async () => {
    app = await startApp(provider);
    const { jar, location } = await login();

    expect(location).toBe('/');

    const me = await jar(`${app.baseUrl}/me`);
    expect(await me.json()).toEqual({ username: 'testmember', verified: true });
  });

  it('honours returnTo', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();

    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login?returnTo=%2Fdashboard`);
    const authorizeUrl = new URL(loginResponse.headers.get('location')!);
    provider.lastNonce = authorizeUrl.searchParams.get('nonce') ?? undefined;

    const callback = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(
        authorizeUrl.searchParams.get('state')!,
      )}`,
    );

    expect(callback.headers.get('location')).toBe('/dashboard');
  });

  // Open redirect: the member trusts your domain and lands somewhere else.
  it('ignores an off-site returnTo', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();

    const loginResponse = await jar(
      `${app.baseUrl}/auth/keslr/login?returnTo=${encodeURIComponent('https://evil.example')}`,
    );
    const authorizeUrl = new URL(loginResponse.headers.get('location')!);
    provider.lastNonce = authorizeUrl.searchParams.get('nonce') ?? undefined;

    const callback = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(
        authorizeUrl.searchParams.get('state')!,
      )}`,
    );

    expect(callback.headers.get('location')).toBe('/');
  });

  it('rejects a callback with an unknown state', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();
    await jar(`${app.baseUrl}/auth/keslr/login`);

    const response = await jar(`${app.baseUrl}/auth/keslr/callback?code=c&state=never-issued`);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('login_expired');
  });

  it('rejects a replayed callback', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();

    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login`);
    const authorizeUrl = new URL(loginResponse.headers.get('location')!);
    provider.lastNonce = authorizeUrl.searchParams.get('nonce') ?? undefined;
    const state = authorizeUrl.searchParams.get('state')!;
    const callbackUrl = `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(state)}`;

    expect((await jar(callbackUrl)).status).toBe(302);
    // The pending request is consumed on first use.
    expect((await jar(callbackUrl)).status).toBe(400);
  });

  it('surfaces a provider error from the token endpoint', async () => {
    app = await startApp(provider);
    provider.tokenError = { error: 'invalid_grant', error_description: 'Code expired' };

    const jar = createCookieJar();
    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login`);
    const authorizeUrl = new URL(loginResponse.headers.get('location')!);

    const response = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(
        authorizeUrl.searchParams.get('state')!,
      )}`,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('provider_error');
  });

  it('surfaces an error returned on the authorization response', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();

    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login`);
    const state = new URL(loginResponse.headers.get('location')!).searchParams.get('state')!;

    const response = await jar(
      `${app.baseUrl}/auth/keslr/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );

    expect(response.status).toBe(400);
  });

  it('signs in an unverified member by default', async () => {
    app = await startApp(provider);
    provider.nextClaims = { verification_status: 'pending_verification' };

    const { jar } = await login();
    const me = await jar(`${app.baseUrl}/me`);

    expect(await me.json()).toEqual({ username: 'testmember', verified: false });
  });

  it('refuses an unverified member when requireVerified is set', async () => {
    app = await startApp(provider, { requireVerified: true });
    provider.nextClaims = { verification_status: 'unverified' };

    const jar = createCookieJar();
    const loginResponse = await jar(`${app.baseUrl}/auth/keslr/login`);
    const authorizeUrl = new URL(loginResponse.headers.get('location')!);
    provider.lastNonce = authorizeUrl.searchParams.get('nonce') ?? undefined;

    const response = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(
        authorizeUrl.searchParams.get('state')!,
      )}`,
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('not_verified');
    expect(body.verification_status).toBe('unverified');
  });

  it('invokes onLogin with the member', async () => {
    const seen: string[] = [];
    app = await startApp(provider, {
      onLogin: (_req: unknown, { user }: { user: { username?: string } }) => {
        seen.push(user.username ?? '');
      },
    });

    await login();

    expect(seen).toEqual(['testmember']);
  });

  it('logs out and clears the session', async () => {
    app = await startApp(provider);
    const { jar } = await login();

    expect(await (await jar(`${app.baseUrl}/me`)).json()).not.toBeNull();

    const logout = await jar(`${app.baseUrl}/auth/keslr/logout`, { method: 'POST' });
    expect(logout.status).toBe(302);
    expect(logout.headers.get('location')).toContain('/oidc/logout');

    expect(await (await jar(`${app.baseUrl}/me`)).json()).toBeNull();
  });

  it('supports a custom basePath', async () => {
    app = await startApp(provider, { basePath: '/sso' });

    const response = await createCookieJar()(`${app.baseUrl}/sso/login`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/oidc/authorize');
  });

  it('supports concurrent logins from two tabs', async () => {
    app = await startApp(provider);
    const jar = createCookieJar();

    // Two logins started, neither finished.
    const first = new URL((await jar(`${app.baseUrl}/auth/keslr/login`)).headers.get('location')!);
    const second = new URL((await jar(`${app.baseUrl}/auth/keslr/login`)).headers.get('location')!);

    // The *older* tab completes. It must still work.
    provider.lastNonce = first.searchParams.get('nonce') ?? undefined;
    const response = await jar(
      `${app.baseUrl}/auth/keslr/callback?code=c&state=${encodeURIComponent(
        first.searchParams.get('state')!,
      )}`,
    );

    expect(response.status).toBe(302);
    expect(second.searchParams.get('state')).not.toBe(first.searchParams.get('state'));
  });

  it('rejects a login when no session middleware is mounted', async () => {
    const bare: Express = express();
    bare.use(
      keslrAuth({
        issuer: provider.issuer,
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:1/callback',
      }),
    );
    bare.use(
      (
        err: Error,
        _req: unknown,
        res: { status(c: number): { json(b: unknown): void } },
        _n: unknown,
      ) => {
        res.status(500).json({ message: err.message });
      },
    );

    const server = createServer(bare);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/keslr/login`, {
        redirect: 'manual',
      });
      expect(response.status).toBe(500);
      expect((await response.json()).message).toMatch(/session middleware/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    app = { close: async () => undefined } as App;
  });
});
