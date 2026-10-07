/**
 * Types for `@keslr/express`.
 */

import type { KeslrUser } from '@keslr/auth';

/**
 * What this package attaches to `req.keslr` once a member is signed in.
 *
 * The access token is deliberately *not* here. Handlers rarely need it, and a
 * value that sits on every request object is a value that ends up in an error
 * report, a debug dump, or a log line eventually. Fetch it from the session
 * explicitly when you actually need to call a Keslr API on the member's behalf.
 */
export interface KeslrRequestContext {
  user: KeslrUser;
  /** When the member completed authentication. */
  authenticatedAt: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present when a Keslr member is signed in. */
      keslr?: KeslrRequestContext;
    }
  }
}

export {};
