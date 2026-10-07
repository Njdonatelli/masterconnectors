/**
 * {@link KeslrAuthClient} — the primary entry point of `@keslr/auth`.
 */

import { assertMatchingSubject, toKeslrUser } from './claims.js';
import { DiscoveryCache } from './discovery.js';
import {
  ConfigurationError,
  KeslrAuthError,
  ProviderError,
  TokenValidationError,
} from './errors.js';
import { requestJson } from './http.js';
import { JwksCache } from './jwks.js';
import { noopLogger } from './logger.js';
import { createPkcePair } from './pkce.js';
import { generateNonce, generateState, verifyState, DEFAULT_REQUEST_TTL_MS } from './state.js';
import { decodeJwt, verifyIdToken } from './tokens.js';
import type {
  AuthenticationResult,
  AuthorizationRequest,
  CallbackParameters,
  DiscoveryDocument,
  KeslrAuthClientOptions,
  KeslrIdTokenClaims,
  KeslrUser,
  ResolvedAuthClientOptions,
  TokenResponse,
} from './types.js';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

/** Options for {@link KeslrAuthClient.createAuthorizationUrl}. */
export interface CreateAuthorizationUrlOptions {
  /** Override the default scopes for this request. */
  scopes?: string[];
  /** OIDC `prompt`. `login` forces reauthentication; `none` fails if interaction is needed. */
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
  /** OIDC `login_hint` — prefill the login form with a known address. */
  loginHint?: string;
  /** OIDC `max_age` in seconds. Forces reauthentication if the session is older. */
  maxAge?: number;
  /** Extra authorization parameters. Reserved OIDC parameter names are rejected. */
  extraParams?: Record<string, string>;
  /** Lifetime of the pending request. Default 10 minutes. */
  ttlMs?: number;
}

/** Parameters for {@link KeslrAuthClient.exchangeCode}. */
export interface ExchangeCodeOptions {
  /** Query parameters your callback route received. */
  params: CallbackParameters;
  /** The `state` you generated for this login. */
  expectedState: string;
  /** The `nonce` you generated for this login. */
  expectedNonce: string;
  /** The PKCE verifier you generated for this login. */
  codeVerifier: string;
  /** Fetch UserInfo and merge the claims. Default true. */
  fetchUserInfo?: boolean;
}

/**
 * Parameters that this package controls and callers must not override, because
 * overriding them would silently disable a security property. `state`, `nonce`,
 * and the PKCE parameters are all generated internally.
 */
const RESERVED_PARAMS = new Set([
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
]);

/**
 * An OpenID Connect relying party for Keslr.
 *
 * One instance per application, constructed at startup and reused — it holds the
 * discovery and JWKS caches, so a fresh instance per request throws away those
 * caches and adds two network round-trips to every login.
 *
 * @example
 * ```ts
 * const keslr = new KeslrAuthClient({
 *   issuer: 'https://api.keslr.com',
 *   clientId: process.env.KESLR_CLIENT_ID!,
 *   clientSecret: process.env.KESLR_CLIENT_SECRET,
 *   redirectUri: 'https://example.com/auth/keslr/callback',
 * });
 *
 * // 1. Start the login.
 * const request = await keslr.createAuthorizationUrl();
 * await store.put(toPendingRequest(request));
 * res.redirect(request.url);
 *
 * // 2. Complete it in your callback.
 * const pending = await store.take(req.query.state);
 * const { user } = await keslr.exchangeCode({
 *   params: req.query,
 *   expectedState: pending.state,
 *   expectedNonce: pending.nonce,
 *   codeVerifier: pending.codeVerifier,
 * });
 * ```
 */
export class KeslrAuthClient {
  private readonly options: ResolvedAuthClientOptions;
  private readonly discovery: DiscoveryCache;
  private jwks?: JwksCache;

  constructor(options: KeslrAuthClientOptions) {
    this.options = resolveOptions(options);

    this.discovery = new DiscoveryCache({
      issuer: this.options.issuer,
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      cacheTtlMs: this.options.discoveryCacheTtlMs,
      fetch: this.options.fetch,
      logger: this.options.logger,
    });
  }

  /** The resolved issuer, with any trailing slash removed. */
  get issuer(): string {
    return this.options.issuer;
  }

  /** The configured client ID. */
  get clientId(): string {
    return this.options.clientId;
  }

  /** True when a client secret was supplied — i.e. this is a confidential client. */
  get isConfidential(): boolean {
    return typeof this.options.clientSecret === 'string' && this.options.clientSecret.length > 0;
  }

  /**
   * Fetch (and cache) the provider metadata document.
   *
   * Call during startup to fail fast on a misconfigured issuer rather than on
   * your first user's login.
   */
  async getDiscoveryDocument(): Promise<DiscoveryDocument> {
    return this.discovery.get();
  }

  /**
   * Build the URL to redirect a member to, along with the secrets required to
   * complete the flow.
   *
   * Persist the returned `state`, `nonce`, and `codeVerifier` server-side keyed
   * by `state`. See {@link AuthorizationRequestStore}.
   */
  async createAuthorizationUrl(
    options: CreateAuthorizationUrlOptions = {},
  ): Promise<AuthorizationRequest> {
    const document = await this.discovery.get();

    const state = generateState();
    const nonce = generateNonce();
    const pkce = createPkcePair();
    const scopes = options.scopes ?? this.options.scopes;

    const url = new URL(document.authorization_endpoint);
    const params = url.searchParams;

    params.set('response_type', 'code');
    params.set('client_id', this.options.clientId);
    params.set('redirect_uri', this.options.redirectUri);
    params.set('scope', scopes.join(' '));
    params.set('state', state);
    params.set('nonce', nonce);
    params.set('code_challenge', pkce.codeChallenge);
    params.set('code_challenge_method', pkce.codeChallengeMethod);

    if (options.prompt) params.set('prompt', options.prompt);
    if (options.loginHint) params.set('login_hint', options.loginHint);
    if (options.maxAge !== undefined) params.set('max_age', String(options.maxAge));

    for (const [key, value] of Object.entries(options.extraParams ?? {})) {
      if (RESERVED_PARAMS.has(key)) {
        throw new ConfigurationError(
          `extraParams may not override the reserved authorization parameter "${key}"`,
          { detail: { param: key } },
        );
      }
      params.set(key, value);
    }

    this.options.logger.debug({ scopes, prompt: options.prompt }, 'Created authorization request');

    return {
      url: url.toString(),
      state,
      nonce,
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + (options.ttlMs ?? DEFAULT_REQUEST_TTL_MS)),
    };
  }

  /**
   * Complete a login: validate the callback, redeem the code, verify the ID
   * token, and optionally merge UserInfo claims.
   *
   * Order matters. `state` is checked *before* the code is redeemed, so a forged
   * callback costs nothing but a comparison — redeeming first would let an
   * attacker consume codes and generate load against the token endpoint.
   *
   * @throws {ProviderError} when Keslr returned an OAuth error.
   * @throws {TokenValidationError} when the ID token failed validation.
   */
  async exchangeCode(options: ExchangeCodeOptions): Promise<AuthenticationResult> {
    const { params } = options;

    if (params.error) {
      throw new ProviderError(params.error, params.error_description, {
        detail: { stage: 'authorization_response' },
      });
    }

    if (!verifyState(params.state, options.expectedState)) {
      throw new KeslrAuthError(
        'state_mismatch',
        'The state returned by Keslr does not match the state for this login attempt',
        { detail: { received: typeof params.state } },
      );
    }

    if (typeof params.code !== 'string' || params.code.length === 0) {
      throw new TokenValidationError(
        'token_response_invalid',
        'The callback carried no authorization code',
      );
    }

    const document = await this.discovery.get();
    const tokens = await this.requestTokens(document, params.code, options.codeVerifier);
    const claims = await this.verifyIdTokenWithJwks(
      document,
      tokens.id_token,
      options.expectedNonce,
    );

    let userInfoClaims: Record<string, unknown> | undefined;
    if (options.fetchUserInfo !== false && document.userinfo_endpoint) {
      userInfoClaims = await this.fetchUserInfo(document.userinfo_endpoint, tokens.access_token);
      assertMatchingSubject(claims.sub, userInfoClaims);
    }

    const user = toKeslrUser(claims, userInfoClaims);

    this.options.logger.info(
      { sub: user.id, keslrId: user.keslrId, verificationStatus: user.verificationStatus },
      'Keslr member authenticated',
    );

    return {
      user,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt:
        typeof tokens.expires_in === 'number'
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : undefined,
      scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [...this.options.scopes],
    };
  }

  /**
   * Verify an ID token that arrived from somewhere other than this client's own
   * exchange — for example, one forwarded by an upstream service.
   *
   * The `nonce` is optional here because a forwarded token has no authorization
   * request of yours to bind to. That weakens replay protection, so prefer
   * exchanging codes yourself where you can.
   */
  async verifyToken(idToken: string, expectedNonce?: string): Promise<KeslrUser> {
    const document = await this.discovery.get();
    const claims = await this.verifyIdTokenWithJwks(document, idToken, expectedNonce);
    return toKeslrUser(claims);
  }

  /**
   * Fetch UserInfo with a member access token.
   *
   * @throws {KeslrAuthError} code `userinfo_failed`.
   */
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const document = await this.discovery.get();
    if (!document.userinfo_endpoint) {
      throw new KeslrAuthError(
        'userinfo_failed',
        'The provider does not advertise a userinfo_endpoint',
      );
    }
    return this.fetchUserInfo(document.userinfo_endpoint, accessToken);
  }

  /**
   * Build the URL that ends the member's Keslr session.
   *
   * Returns `null` when the provider advertises no `end_session_endpoint`, in
   * which case clearing your own session is all you can do — the member stays
   * signed in to Keslr itself.
   */
  async createLogoutUrl(
    options: { idTokenHint?: string; postLogoutRedirectUri?: string } = {},
  ): Promise<string | null> {
    const document = await this.discovery.get();
    if (!document.end_session_endpoint) return null;

    const url = new URL(document.end_session_endpoint);
    if (options.idTokenHint) url.searchParams.set('id_token_hint', options.idTokenHint);
    if (options.postLogoutRedirectUri) {
      url.searchParams.set('post_logout_redirect_uri', options.postLogoutRedirectUri);
    }
    url.searchParams.set('client_id', this.options.clientId);

    return url.toString();
  }

  /** Drop cached discovery and JWKS data. Mostly useful in tests. */
  invalidateCaches(): void {
    this.discovery.invalidate();
    this.jwks?.invalidate();
  }

  // -- internals ------------------------------------------------------------

  private async requestTokens(
    document: DiscoveryDocument,
    code: string,
    codeVerifier: string,
  ): Promise<TokenResponse> {
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      client_id: this.options.clientId,
      code_verifier: codeVerifier,
    };

    const headers: Record<string, string> = {};

    if (this.options.clientSecret) {
      // HTTP Basic is the method OIDC Core §9 recommends, and it keeps the
      // secret out of the request body where body-logging middleware would
      // capture it.
      const credentials = Buffer.from(
        `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`,
      ).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    }

    const response = await requestJson<
      TokenResponse & { error?: string; error_description?: string }
    >(document.token_endpoint, {
      method: 'POST',
      headers,
      form,
      timeoutMs: this.options.timeoutMs,
      maxRetries: 0, // Authorization codes are single-use. Never retry.
      fetch: this.options.fetch,
      logger: this.options.logger,
      operation: 'token',
    });

    if (response.body.error) {
      throw new ProviderError(response.body.error, response.body.error_description, {
        detail: { stage: 'token_endpoint', status: response.status },
      });
    }

    if (response.status !== 200) {
      throw new TokenValidationError(
        'token_response_invalid',
        `Token endpoint returned HTTP ${response.status}`,
        { detail: { status: response.status } },
      );
    }

    const { access_token: accessToken, id_token: idToken, token_type: tokenType } = response.body;

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new TokenValidationError(
        'token_response_invalid',
        'Token response has no access_token',
      );
    }
    if (typeof idToken !== 'string' || idToken.length === 0) {
      throw new TokenValidationError('token_response_invalid', 'Token response has no id_token');
    }
    if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
      throw new TokenValidationError(
        'token_response_invalid',
        `Token response declares token_type "${String(tokenType)}", expected "Bearer"`,
        { detail: { tokenType } },
      );
    }

    return response.body;
  }

  private async verifyIdTokenWithJwks(
    document: DiscoveryDocument,
    idToken: string,
    expectedNonce?: string,
  ): Promise<KeslrIdTokenClaims> {
    const jwks = this.getJwksCache(document);

    // Decoding to read `kid` is safe: nothing is trusted until verifyIdToken
    // has checked the signature over the exact same bytes.
    const { header } = decodeJwt(idToken);
    const key = await jwks.getKey(header.kid);

    return verifyIdToken(idToken, key, {
      issuer: this.options.issuer,
      audience: this.options.clientId,
      nonce: expectedNonce,
      clockToleranceSeconds: this.options.clockToleranceSeconds,
    });
  }

  private getJwksCache(document: DiscoveryDocument): JwksCache {
    if (!this.jwks) {
      this.jwks = new JwksCache(document.jwks_uri, {
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        cacheTtlMs: this.options.jwksCacheTtlMs,
        fetch: this.options.fetch,
        logger: this.options.logger,
      });
    }
    return this.jwks;
  }

  private async fetchUserInfo(
    endpoint: string,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const response = await requestJson<Record<string, unknown>>(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      fetch: this.options.fetch,
      logger: this.options.logger,
      operation: 'userinfo',
    });

    if (response.status !== 200) {
      throw new KeslrAuthError(
        'userinfo_failed',
        `UserInfo endpoint returned HTTP ${response.status}`,
        { detail: { status: response.status } },
      );
    }

    return response.body;
  }
}

/** Apply defaults and reject configurations that cannot work. */
export function resolveOptions(options: KeslrAuthClientOptions): ResolvedAuthClientOptions {
  if (!options.issuer) {
    throw new ConfigurationError('issuer is required, e.g. "https://api.keslr.com"');
  }
  if (!options.clientId) {
    throw new ConfigurationError('clientId is required');
  }
  if (!options.redirectUri) {
    throw new ConfigurationError('redirectUri is required');
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(options.issuer);
  } catch {
    throw new ConfigurationError(`issuer is not a valid URL: ${options.issuer}`);
  }
  if (
    issuerUrl.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '::1'].includes(issuerUrl.hostname)
  ) {
    throw new ConfigurationError(
      `issuer must use https outside local development (got ${options.issuer})`,
    );
  }

  try {
    new URL(options.redirectUri);
  } catch {
    throw new ConfigurationError(
      `redirectUri must be an absolute URL (got ${options.redirectUri}); it must also match a URI registered for this client exactly`,
    );
  }

  const scopes = options.scopes ?? DEFAULT_SCOPES;
  if (!scopes.includes('openid')) {
    throw new ConfigurationError(
      'scopes must include "openid" — without it Keslr performs a plain OAuth 2.0 flow and issues no ID token',
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (timeoutMs <= 0) throw new ConfigurationError('timeoutMs must be greater than 0');

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (maxRetries < 0) throw new ConfigurationError('maxRetries must be 0 or greater');

  const clockToleranceSeconds = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (clockToleranceSeconds < 0) {
    throw new ConfigurationError('clockToleranceSeconds must be 0 or greater');
  }
  if (clockToleranceSeconds > 300) {
    throw new ConfigurationError(
      'clockToleranceSeconds above 300 defeats the purpose of expiry validation; fix your clocks with NTP instead',
    );
  }

  return {
    issuer: options.issuer.replace(/\/+$/, ''),
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
    scopes,
    timeoutMs,
    maxRetries,
    discoveryCacheTtlMs: options.discoveryCacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    jwksCacheTtlMs: options.jwksCacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    clockToleranceSeconds,
    fetch: options.fetch ?? globalThis.fetch,
    logger: options.logger ?? noopLogger,
  };
}
