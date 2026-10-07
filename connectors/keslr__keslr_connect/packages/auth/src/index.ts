/**
 * `@keslr/auth` — an OpenID Connect relying party for Keslr.
 *
 * Keslr is an invite-only network whose members are verified humans. This package
 * lets your application accept "Sign in with Keslr" and, crucially, read the
 * `verification_status` claim that says whether the person signing in has been
 * vouched for through Keslr's trust graph.
 *
 * @example Minimal Express integration
 * ```ts
 * import { KeslrAuthClient, MemoryAuthorizationRequestStore, toPendingRequest, assertVerified }
 *   from '@keslr/auth';
 *
 * const keslr = new KeslrAuthClient({
 *   issuer: 'https://api.keslr.com',
 *   clientId: process.env.KESLR_CLIENT_ID!,
 *   clientSecret: process.env.KESLR_CLIENT_SECRET,
 *   redirectUri: 'https://example.com/auth/keslr/callback',
 * });
 * const store = new MemoryAuthorizationRequestStore();
 *
 * app.get('/login', async (_req, res) => {
 *   const request = await keslr.createAuthorizationUrl();
 *   store.put(toPendingRequest(request));
 *   res.redirect(request.url);
 * });
 *
 * app.get('/auth/keslr/callback', async (req, res) => {
 *   const pending = store.take(String(req.query.state));
 *   if (!pending) return res.status(400).send('Login expired, please try again.');
 *
 *   const { user } = await keslr.exchangeCode({
 *     params: req.query,
 *     expectedState: pending.state,
 *     expectedNonce: pending.nonce,
 *     codeVerifier: pending.codeVerifier,
 *   });
 *
 *   assertVerified(user);
 *   req.session.userId = user.id;
 *   res.redirect(pending.returnTo ?? '/');
 * });
 * ```
 *
 * @packageDocumentation
 */

export { KeslrAuthClient, resolveOptions } from './client.js';
export type { CreateAuthorizationUrlOptions, ExchangeCodeOptions } from './client.js';

export {
  assertMatchingSubject,
  assertVerified,
  describeVerificationStatus,
  isVerified,
  normalizeVerificationStatus,
  toKeslrUser,
  VERIFICATION_STATUSES,
} from './claims.js';

export {
  ConfigurationError,
  DiscoveryError,
  isKeslrAuthError,
  JwksError,
  KeslrAuthError,
  NotVerifiedError,
  ProviderError,
  TokenValidationError,
  TransportError,
} from './errors.js';
export type { KeslrAuthErrorCode, KeslrAuthErrorOptions } from './errors.js';

export {
  assertValidCodeVerifier,
  CODE_CHALLENGE_METHOD,
  createPkcePair,
  deriveCodeChallenge,
  generateCodeVerifier,
  verifyCodeChallenge,
} from './pkce.js';
export type { PkcePair } from './pkce.js';

export {
  DEFAULT_REQUEST_TTL_MS,
  generateNonce,
  generateState,
  MemoryAuthorizationRequestStore,
  toPendingRequest,
  verifyState,
} from './state.js';
export type { AuthorizationRequestStore, PendingAuthorizationRequest } from './state.js';

export {
  constantTimeEquals,
  decodeJwt,
  SUPPORTED_ALGORITHM,
  validateClaims,
  verifyIdToken,
  verifySignature,
} from './tokens.js';
export type { DecodedJwt, JwtHeader, ValidationOptions } from './tokens.js';

export {
  assertValidDiscoveryDocument,
  buildDiscoveryUrl,
  DISCOVERY_PATH,
  DiscoveryCache,
} from './discovery.js';

export { isUsableSigningKey, JwksCache, JWKS_REFRESH_COOLDOWN_MS } from './jwks.js';

export { createConsoleLogger, noopLogger, redact } from './logger.js';

export { backoffDelayMs } from './http.js';

export type {
  AuthenticationResult,
  AuthorizationRequest,
  CallbackParameters,
  DiscoveryDocument,
  FetchLike,
  JsonWebKey,
  JsonWebKeySet,
  KeslrAuthClientOptions,
  KeslrIdTokenClaims,
  KeslrUser,
  Logger,
  ResolvedAuthClientOptions,
  TokenResponse,
  VerificationMethod,
  VerificationStatus,
} from './types.js';
