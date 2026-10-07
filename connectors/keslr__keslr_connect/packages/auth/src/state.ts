/**
 * `state` and `nonce` generation, and the pending-request store.
 *
 * These two values do different jobs and are often confused:
 *
 * - **`state`** travels through the browser and comes back on the redirect. It
 *   binds the callback to *your* login attempt, defeating CSRF: an attacker who
 *   tricks a victim's browser into hitting your callback with the attacker's
 *   authorization code cannot produce a matching `state`, so the victim never
 *   gets silently logged into the attacker's account.
 *
 * - **`nonce`** travels to the provider and comes back *inside the ID token*. It
 *   binds the token to your login attempt, defeating replay: a token captured
 *   from an earlier session carries an old nonce and is rejected.
 *
 * You need both. `state` protects the redirect; `nonce` protects the token.
 */

import { randomBytes } from 'node:crypto';
import { encodeBase64Url } from './base64url.js';
import { constantTimeEquals } from './tokens.js';
import type { AuthorizationRequest } from './types.js';

/** 32 bytes — the same entropy budget as the PKCE verifier. */
const RANDOM_BYTES = 32;

/** Default lifetime of a pending authorization request. */
export const DEFAULT_REQUEST_TTL_MS = 10 * 60 * 1000;

/** Generate a random, URL-safe `state` value. */
export function generateState(): string {
  return encodeBase64Url(randomBytes(RANDOM_BYTES));
}

/** Generate a random, URL-safe `nonce` value. */
export function generateNonce(): string {
  return encodeBase64Url(randomBytes(RANDOM_BYTES));
}

/**
 * Compare a returned `state` against the expected value in constant time.
 *
 * Always use this rather than `===`. String comparison in V8 short-circuits at
 * the first differing byte, which leaks a prefix oracle to an attacker who can
 * measure your callback's response time.
 */
export function verifyState(received: string | undefined, expected: string): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  return constantTimeEquals(received, expected);
}

/**
 * A pending authorization request, minus the URL.
 *
 * This is what a store persists between the login redirect and the callback.
 */
export interface PendingAuthorizationRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
  /** Where to send the member after a successful login. */
  returnTo?: string;
}

/**
 * Storage for pending authorization requests.
 *
 * Implement this against whatever your application already uses for sessions.
 * Two requirements that are easy to get wrong:
 *
 * 1. **Server-side only.** The `codeVerifier` is a secret. A cookie-backed
 *    implementation must encrypt it, not merely sign it.
 * 2. **Single use.** `take` must atomically read *and delete*. Leaving entries
 *    behind allows an authorization code to be replayed against your callback.
 */
export interface AuthorizationRequestStore {
  put(request: PendingAuthorizationRequest): Promise<void> | void;
  /** Read and remove the request for `state`, or return null if absent. */
  take(
    state: string,
  ): Promise<PendingAuthorizationRequest | null> | PendingAuthorizationRequest | null;
}

/**
 * An in-memory store, suitable for development and single-process deployments.
 *
 * Not suitable for production behind a load balancer: a login that starts on one
 * instance and returns to another will fail, because the pending request lives
 * only in the first instance's heap. Use a shared session store, Redis, or a
 * database table instead.
 */
export class MemoryAuthorizationRequestStore implements AuthorizationRequestStore {
  private readonly entries = new Map<string, PendingAuthorizationRequest>();

  constructor(private readonly maxEntries = 10_000) {}

  put(request: PendingAuthorizationRequest): void {
    this.evictExpired();

    // Bound memory. Without this, an attacker who can hit your login endpoint
    // repeatedly grows the map until the process dies.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }

    this.entries.set(request.state, request);
  }

  take(state: string): PendingAuthorizationRequest | null {
    const entry = this.entries.get(state);
    if (!entry) return null;

    // Single use, whether or not it turns out to be expired.
    this.entries.delete(state);

    if (entry.expiresAt.getTime() <= Date.now()) return null;
    return entry;
  }

  /** Current entry count. Diagnostics and tests. */
  size(): number {
    return this.entries.size;
  }

  /** Drop every entry. Invalidates all in-flight logins. */
  clear(): void {
    this.entries.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [state, entry] of this.entries) {
      if (entry.expiresAt.getTime() <= now) this.entries.delete(state);
    }
  }
}

/** Reduce a full {@link AuthorizationRequest} to the part worth persisting. */
export function toPendingRequest(
  request: AuthorizationRequest,
  returnTo?: string,
): PendingAuthorizationRequest {
  return {
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    expiresAt: request.expiresAt,
    returnTo,
  };
}
