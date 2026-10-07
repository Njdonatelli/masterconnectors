/**
 * Express middleware that attaches the calling Keslr member to each request.
 *
 * ## What this does and does not prove
 *
 * The identity here is derived from the *source address of the TCP connection*,
 * resolved through Keslr's coordination layer. That is a genuine, network-level
 * fact: the connection came from a device registered to that member. It is not
 * the same as an OIDC login, and the difference matters:
 *
 * - It identifies a **device owner**, not necessarily the person at the keyboard.
 *   A shared or compromised machine speaks with its owner's identity.
 * - It carries **no session, no consent, no scopes**. The member never chose to
 *   sign in to your application.
 * - It is only as trustworthy as your network path. If anything can reach your
 *   service without traversing the Keslr network, the source address means
 *   nothing at all.
 *
 * Use it for attribution, personalisation, rate limiting, and audit logging.
 * For anything that changes money, permissions, or private data, require a real
 * login with `@keslr/auth` as well.
 *
 * ## Binding matters more than this middleware
 *
 * This middleware cannot make a publicly-reachable service private. If your
 * server binds `0.0.0.0`, anyone can connect and simply not be a Keslr member.
 * Bind to your host's Keslr address instead — see the `hosting-on-keslr` guide.
 */

import type { IdentityLookup } from './lookup.js';
import { IdentityUnknownError } from './errors.js';
import type { NetworkIdentity } from './types.js';

/** The minimal request shape this middleware needs. Avoids an Express dependency. */
export interface MinimalRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
  keslrNetwork?: NetworkIdentity | null;
}

export interface MinimalResponse {
  status(code: number): MinimalResponse;
  json(body: unknown): unknown;
}

export type NextFunction = (error?: unknown) => void;

export interface IdentityMiddlewareOptions {
  lookup: IdentityLookup;
  /**
   * Reject requests whose address has no Keslr owner.
   *
   * Default false: the identity is attached when known and left null otherwise,
   * letting your handlers decide. Set true for a service that must only ever be
   * reachable by members — but read the note above about binding first, because
   * this flag is a second line of defence, not the first.
   */
  strict?: boolean;
  /**
   * Trust `X-Forwarded-For` for the client address.
   *
   * **Default false, and think carefully before changing it.** A forwarded
   * header is client-supplied data. If anything other than your own trusted
   * proxy can reach this service, an attacker sets the header to a member's
   * address and inherits their identity. Only enable this when a proxy you
   * control overwrites the header on every request.
   */
  trustProxy?: boolean;
  /** Called when a lookup fails. Default: attach null and continue. */
  onLookupError?: (error: unknown, address: string) => void;
}

/**
 * Build the middleware.
 *
 * @example
 * ```ts
 * app.use(keslrNetworkIdentity({ lookup }));
 *
 * app.get('/whoami', (req, res) => {
 *   if (!req.keslrNetwork) return res.json({ member: null });
 *   res.json({ member: req.keslrNetwork.username });
 * });
 * ```
 */
export function keslrNetworkIdentity(options: IdentityMiddlewareOptions) {
  const { lookup, strict = false, trustProxy = false, onLookupError } = options;

  return async function keslrNetworkIdentityMiddleware(
    req: MinimalRequest,
    _res: MinimalResponse,
    next: NextFunction,
  ): Promise<void> {
    const address = extractClientAddress(req, trustProxy);

    if (!address) {
      req.keslrNetwork = null;
      if (strict) next(new IdentityUnknownError('unknown'));
      else next();
      return;
    }

    try {
      const identity = await lookup.resolve(address);
      req.keslrNetwork = identity;

      if (strict && !identity) {
        next(new IdentityUnknownError(address));
        return;
      }

      next();
    } catch (error) {
      onLookupError?.(error, address);
      req.keslrNetwork = null;

      // A lookup outage must not become an outage of your service — unless the
      // service is strict, in which case failing closed is the whole point.
      if (strict) next(error);
      else next();
    }
  };
}

/**
 * Determine the client address for a request.
 *
 * Normalises IPv4-mapped IPv6 addresses (`::ffff:100.64.0.1`), which is how
 * Node reports IPv4 clients on a dual-stack listener and which would otherwise
 * never match a lookup.
 */
export function extractClientAddress(req: MinimalRequest, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // Left-most entry is the original client; the rest are proxies.
    const candidate = raw?.split(',')[0]?.trim();
    if (candidate) return normalizeAddress(candidate);
  }

  const direct = req.ip ?? req.socket?.remoteAddress;
  return direct ? normalizeAddress(direct) : undefined;
}

/** Strip the IPv4-mapped IPv6 prefix and any zone identifier. */
export function normalizeAddress(address: string): string {
  let normalized = address.trim();

  if (normalized.startsWith('::ffff:')) normalized = normalized.slice(7);

  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) normalized = normalized.slice(0, zoneIndex);

  return normalized;
}

/**
 * A guard that rejects requests with no resolved Keslr identity.
 *
 * Use after {@link keslrNetworkIdentity} in non-strict mode when only some
 * routes need to be members-only.
 */
export function requireNetworkIdentity() {
  return function requireNetworkIdentityMiddleware(
    req: MinimalRequest,
    res: MinimalResponse,
    next: NextFunction,
  ): void {
    if (!req.keslrNetwork) {
      res.status(403).json({
        error: 'not_a_keslr_member',
        message: 'This endpoint is only reachable from the Keslr network.',
      });
      return;
    }
    next();
  };
}
