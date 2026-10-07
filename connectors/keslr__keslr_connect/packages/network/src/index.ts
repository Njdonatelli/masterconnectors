/**
 * `@keslr/network` — know which Keslr member is calling your service.
 *
 * A service running on the Keslr network is reachable by members at a Keslr
 * address, and not from the public internet. Requests therefore arrive from
 * addresses the network itself has assigned to members, and this package turns
 * those addresses into identities:
 *
 * ```
 *   request from 100.64.0.7  →  IdentityLookup  →  { username: 'somemember', … }
 * ```
 *
 * That is useful for logs, personalisation, and rate limiting. It is *not* a
 * substitute for a login — see the note on {@link keslrNetworkIdentity} — so
 * pair it with `@keslr/auth` for anything sensitive.
 *
 * @example
 * ```ts
 * import { IdentityLookup, keslrNetworkIdentity } from '@keslr/network';
 *
 * const lookup = new IdentityLookup({
 *   baseUrl: 'https://api.keslr.com',
 *   clientId: process.env.KESLR_NETWORK_CLIENT_ID,
 *   clientSecret: process.env.KESLR_NETWORK_CLIENT_SECRET,
 * });
 *
 * app.use(keslrNetworkIdentity({ lookup }));
 *
 * app.get('/whoami', (req, res) => {
 *   res.json({ member: req.keslrNetwork?.username ?? null });
 * });
 * ```
 *
 * @packageDocumentation
 */

export { IdentityLookup } from './lookup.js';
export type { IdentityLookupOptions } from './lookup.js';

export {
  extractClientAddress,
  keslrNetworkIdentity,
  normalizeAddress,
  requireNetworkIdentity,
} from './middleware.js';
export type {
  IdentityMiddlewareOptions,
  MinimalRequest,
  MinimalResponse,
  NextFunction,
} from './middleware.js';

export {
  IdentityUnknownError,
  isKeslrNetworkError,
  KeslrNetworkError,
  LookupError,
} from './errors.js';
export type { KeslrNetworkErrorCode, KeslrNetworkErrorOptions } from './errors.js';

export type { FetchLike, Logger, NetworkIdentity, NetworkIdentityMap } from './types.js';
