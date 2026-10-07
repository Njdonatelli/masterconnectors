/**
 * Session-backed storage for pending authorization requests and signed-in users.
 */

import type {
  AuthorizationRequestStore,
  KeslrUser,
  PendingAuthorizationRequest,
} from '@keslr/auth';

/** The subset of `express-session` this package requires. */
export interface SessionLike {
  keslr?: KeslrSession;
  /** Regenerate the session ID. Present on express-session. */
  regenerate?(callback: (err?: unknown) => void): void;
  destroy?(callback: (err?: unknown) => void): void;
  save?(callback: (err?: unknown) => void): void;
}

/** What this package stores in the session. */
export interface KeslrSession {
  /** In-flight authorization requests, keyed by `state`. */
  pending?: Record<string, SerializedPendingRequest>;
  /** The signed-in member. */
  user?: KeslrUser;
  /** ISO timestamp of authentication. */
  authenticatedAt?: string;
  /** Retained only so logout can pass `id_token_hint` to the provider. */
  idToken?: string;
}

interface SerializedPendingRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: string;
  returnTo?: string;
}

/**
 * An {@link AuthorizationRequestStore} backed by the request's session.
 *
 * This is the right default for a web application: the pending request lives
 * exactly as long as the browser session that started it, and a shared session
 * store makes it work across multiple instances for free.
 *
 * Note the concurrency caveat. A member can legitimately have several logins in
 * flight — two tabs, or a stale one they abandoned — so requests are stored in a
 * map keyed by `state` rather than in a single slot. Storing only the most
 * recent would break the older tab, which users experience as "login randomly
 * fails sometimes" and which is miserable to diagnose.
 */
export class SessionAuthorizationRequestStore implements AuthorizationRequestStore {
  /** Cap on concurrent pending logins per session. */
  private static readonly MAX_PENDING = 8;

  constructor(private readonly session: SessionLike) {}

  put(request: PendingAuthorizationRequest): void {
    const keslr = (this.session.keslr ??= {});
    const pending = (keslr.pending ??= {});

    // Drop anything expired before adding, so an abandoned tab does not
    // accumulate entries forever.
    const now = Date.now();
    for (const [state, entry] of Object.entries(pending)) {
      if (new Date(entry.expiresAt).getTime() <= now) delete pending[state];
    }

    const states = Object.keys(pending);
    if (states.length >= SessionAuthorizationRequestStore.MAX_PENDING) {
      // Evict the oldest by expiry.
      const oldest = states.sort(
        (a, b) =>
          new Date(pending[a]!.expiresAt).getTime() - new Date(pending[b]!.expiresAt).getTime(),
      )[0];
      if (oldest) delete pending[oldest];
    }

    pending[request.state] = {
      state: request.state,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      expiresAt: request.expiresAt.toISOString(),
      returnTo: request.returnTo,
    };
  }

  take(state: string): PendingAuthorizationRequest | null {
    const pending = this.session.keslr?.pending;
    if (!pending) return null;

    const entry = pending[state];
    if (!entry) return null;

    // Single use, whether or not it turns out to have expired.
    delete pending[state];

    const expiresAt = new Date(entry.expiresAt);
    if (expiresAt.getTime() <= Date.now()) return null;

    return {
      state: entry.state,
      nonce: entry.nonce,
      codeVerifier: entry.codeVerifier,
      expiresAt,
      returnTo: entry.returnTo,
    };
  }

  /** Number of pending requests. Diagnostics and tests. */
  size(): number {
    return Object.keys(this.session.keslr?.pending ?? {}).length;
  }
}

/**
 * Regenerate the session ID, preserving Keslr state, and return the *new*
 * session object.
 *
 * Call immediately after a successful login. Without it, an attacker who fixed
 * the victim's session ID before login — by any means that lets them set a
 * cookie — still holds a valid ID afterwards, and is now inside the victim's
 * authenticated session. This is session fixation, and regeneration is the fix.
 *
 * **Use the returned session, not the one you passed in.** `express-session`
 * replaces `req.session` with a fresh object during regeneration, so the
 * reference you held beforehand is detached: anything written to it is silently
 * discarded when the response is saved. This is an easy mistake to make and a
 * miserable one to debug, since the login appears to succeed and the member is
 * simply not signed in afterwards.
 *
 * @param holder - The object owning the session, normally the Express request.
 * @returns The session to write to from this point on.
 */
export function regenerateSession(holder: { session?: SessionLike }): Promise<SessionLike> {
  return new Promise((resolve, reject) => {
    const session = holder.session;

    if (!session) {
      reject(new Error('No session to regenerate'));
      return;
    }

    if (typeof session.regenerate !== 'function') {
      // Not express-session. The caller is responsible for rotation.
      resolve(session);
      return;
    }

    const preserved = session.keslr;

    session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      // express-session has now swapped holder.session for a new object.
      const rotated = holder.session ?? session;
      rotated.keslr = preserved;
      resolve(rotated);
    });
  });
}

/** Destroy the session, if the store supports it. */
export function destroySession(session: SessionLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof session.destroy !== 'function') {
      delete session.keslr;
      resolve();
      return;
    }

    session.destroy((error) => (error ? reject(error) : resolve()));
  });
}
