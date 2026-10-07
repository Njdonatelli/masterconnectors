/**
 * Public types for `@keslr/auth`.
 */

/**
 * Where a member sits in Keslr's verification lifecycle.
 *
 * Keslr is invite-only: members are verified at registration by accepting an
 * invitation from an existing verified member, so in practice the overwhelming
 * majority of accounts your application sees are `verified`. The other states
 * exist and must be handled.
 *
 * - `verified` — a real human, vouched for through the trust graph. The only
 *   state in which {@link KeslrUser.isVerified} is true.
 * - `pending_verification` — verification is underway and not yet decided.
 * - `unverified` — registered but never verified.
 * - `rejected` — verification was attempted and refused.
 */
export type VerificationStatus = 'verified' | 'pending_verification' | 'unverified' | 'rejected';

/**
 * How a member came to be verified. Useful for risk decisions: an application
 * handling money might treat `referral_approved` differently from
 * `core_approver_invite`, since the latter originates closer to Keslr itself.
 *
 * The string union is open-ended by design — Keslr may add methods, and an
 * unrecognised value must never crash your integration.
 */
export type VerificationMethod =
  | 'core_approver_invite'
  | 'referral_approved'
  | 'referral_accepted'
  | 'moderator_approved'
  | 'force_approved'
  | (string & {});

/** Standard OIDC claims Keslr issues, plus the three Keslr-specific ones. */
export interface KeslrIdTokenClaims {
  /** Issuer. Always the configured Keslr issuer URL. */
  iss: string;
  /** Subject — Keslr's internal user UUID. Stable forever; safe as a foreign key. */
  sub: string;
  /** Audience — your `client_id`. May be an array per the OIDC spec. */
  aud: string | string[];
  /** Expiry, seconds since the epoch. */
  exp: number;
  /** Issued-at, seconds since the epoch. */
  iat: number;
  /** Not-before, seconds since the epoch. Optional. */
  nbf?: number;
  /** Replay guard echoed from the authorization request. */
  nonce?: string;
  /** Authorized party. Present when `aud` has multiple entries. */
  azp?: string;
  /** Time of the original authentication event, seconds since the epoch. */
  auth_time?: number;

  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;

  /**
   * Keslr's public member identifier, of the form `KID-XXXXXXXXXXXX`.
   *
   * Prefer {@link KeslrIdTokenClaims.sub} as your database key — it is the
   * canonical identifier. Use `keslr_id` when you need something to display, or
   * to cross-reference against Keslr's other APIs.
   */
  keslr_id?: string;

  /** @see VerificationStatus */
  verification_status?: VerificationStatus;

  /** @see VerificationMethod */
  verification_method?: VerificationMethod;

  [claim: string]: unknown;
}

/**
 * A Keslr member, normalised from ID token and UserInfo claims.
 *
 * This is the object your application should persist and reason about. It
 * flattens the two claim sources into one shape and pre-computes
 * {@link KeslrUser.isVerified} so authorization checks never depend on getting
 * a string comparison right at each call site.
 */
export interface KeslrUser {
  /** Keslr's internal UUID — the `sub` claim. Use this as your foreign key. */
  id: string;
  /** Public member identifier, `KID-XXXXXXXXXXXX`. Absent on very old accounts. */
  keslrId?: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
  username?: string;
  verificationStatus: VerificationStatus;
  verificationMethod?: VerificationMethod;
  /**
   * True only when {@link KeslrUser.verificationStatus} is exactly `verified`.
   *
   * Prefer this to comparing the status string yourself — see `claims.ts` for
   * why the comparison is centralised.
   */
  isVerified: boolean;
  /** Every claim received, merged. Escape hatch for claims added after this release. */
  raw: KeslrIdTokenClaims;
}

/** The provider metadata document from `/.well-known/openid-configuration`. */
export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  subject_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  claims_supported?: string[];
  [field: string]: unknown;
}

/** A single JSON Web Key. Only the RSA fields this package uses are modelled. */
export interface JsonWebKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [field: string]: unknown;
}

export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

/** Raw token endpoint response. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token: string;
  scope?: string;
}

/** The result of a completed login. */
export interface AuthenticationResult {
  /** The authenticated member. */
  user: KeslrUser;
  /** Bearer token for Keslr APIs that accept member credentials. */
  accessToken: string;
  /** Present only when the `offline_access` scope was granted. */
  refreshToken?: string;
  /** The raw ID token. Retain only if you need to forward it downstream. */
  idToken: string;
  /** Absolute expiry of the access token, or `undefined` if unknown. */
  expiresAt?: Date;
  /** Scopes actually granted, which may be narrower than those requested. */
  scopes: string[];
}

/**
 * Everything the callback handler needs, produced by
 * `KeslrAuthClient.createAuthorizationUrl()`.
 *
 * Persist this server-side against the browser session. The `codeVerifier` is a
 * secret: it must never be sent to the browser, logged, or placed in a URL.
 */
export interface AuthorizationRequest {
  /** Send the browser here. */
  url: string;
  /** CSRF guard. Compare against the `state` returned to your callback. */
  state: string;
  /** Replay guard. Compare against the `nonce` claim in the ID token. */
  nonce: string;
  /** PKCE verifier. Secret. Required at the token endpoint. */
  codeVerifier: string;
  /** When this request should be considered stale, typically 10 minutes out. */
  expiresAt: Date;
}

/** Parameters your callback route received from Keslr. */
export interface CallbackParameters {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/** Minimal structured logger. Compatible with pino, bunyan, and console. */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** The subset of `fetch` this package relies on. Inject to test or to proxy. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Options accepted by `new KeslrAuthClient(...)`. */
export interface KeslrAuthClientOptions {
  /**
   * Keslr's issuer URL, e.g. `https://api.keslr.com`.
   *
   * Must exactly match the `iss` claim in issued tokens, including the absence
   * of a trailing slash. A mismatch is the single most common cause of
   * `id_token_claims_invalid`.
   */
  issuer: string;
  /** The client ID from your app's registration at developers.keslr.com. */
  clientId: string;
  /**
   * The client secret, for confidential clients only.
   *
   * Public clients — SPAs, mobile, anything running on a device you don't
   * control — must omit this and rely on PKCE. Shipping a secret to a browser
   * does not make the client confidential; it makes the secret public.
   */
  clientSecret?: string;
  /** Redirect URI. Must byte-for-byte match one registered for the client. */
  redirectUri: string;
  /** Scopes to request. Defaults to `['openid', 'profile', 'email']`. */
  scopes?: string[];
  /** Per-request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Retry attempts for idempotent GETs on 5xx / network failure. Default 2. */
  maxRetries?: number;
  /** Discovery document cache TTL in milliseconds. Default 3600000 (1 hour). */
  discoveryCacheTtlMs?: number;
  /** JWKS cache TTL in milliseconds. Default 3600000 (1 hour). */
  jwksCacheTtlMs?: number;
  /**
   * Clock skew tolerance in seconds when validating `exp`, `iat`, and `nbf`.
   * Default 60. Raise only if you have servers with genuinely unreliable clocks.
   */
  clockToleranceSeconds?: number;
  /** Injected `fetch`. Defaults to the global. */
  fetch?: FetchLike;
  /** Injected logger. Defaults to a no-op. */
  logger?: Logger;
}

/** Fully resolved options, with defaults applied. */
export type ResolvedAuthClientOptions = Required<
  Omit<KeslrAuthClientOptions, 'clientSecret' | 'logger' | 'fetch'>
> & {
  clientSecret?: string;
  logger: Logger;
  fetch: FetchLike;
};
