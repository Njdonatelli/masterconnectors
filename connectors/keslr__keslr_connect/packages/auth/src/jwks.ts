/**
 * JWKS handling: fetching, caching, and key rotation.
 *
 * Keslr signs ID tokens with RS256 and publishes the corresponding public keys
 * at the `jwks_uri` from discovery. Verification requires selecting the right
 * key by `kid` and constructing a public key object from the JWK.
 *
 * The subtle part is rotation. When Keslr rotates its signing key, tokens start
 * arriving with a `kid` that is not in your cache. Refetching on a cache miss
 * handles that — but naively, it also hands an attacker a way to make you issue
 * an unbounded number of outbound requests by sending tokens with random `kid`
 * values. So refetch-on-miss is rate limited by {@link JWKS_REFRESH_COOLDOWN_MS};
 * within the cooldown window, an unknown `kid` fails fast instead of refetching.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import { JwksError } from './errors.js';
import { requestJson } from './http.js';
import type { FetchLike, JsonWebKey, JsonWebKeySet, Logger } from './types.js';

/**
 * Minimum interval between refetches triggered by a cache miss.
 *
 * Chosen to be far shorter than any sane rotation interval — so a genuine
 * rotation recovers within seconds — while still bounding a hostile client to a
 * handful of requests per minute.
 */
export const JWKS_REFRESH_COOLDOWN_MS = 30_000;

export interface JwksOptions {
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  fetch: FetchLike;
  logger: Logger;
}

interface CacheEntry {
  keys: Map<string, KeyObject>;
  /** Keys with no `kid`, in document order. Used only as a last resort. */
  anonymousKeys: KeyObject[];
  expiresAt: number;
}

/**
 * Caches the provider's signing keys and resolves them by `kid`.
 *
 * One instance per issuer. Safe to share across concurrent requests: as with
 * discovery, a single in-flight fetch is shared rather than duplicated.
 */
export class JwksCache {
  private entry?: CacheEntry;
  private inFlight?: Promise<CacheEntry>;
  private lastRefreshAt = 0;

  constructor(
    private readonly jwksUri: string,
    private readonly options: JwksOptions,
  ) {}

  /**
   * Resolve the public key for a `kid`.
   *
   * On a miss, refetches once — subject to the cooldown — to pick up a rotated
   * key. A token whose `kid` is still absent after that is rejected.
   *
   * @param kid - The `kid` header from the JWT, or `undefined` if it had none.
   */
  async getKey(kid: string | undefined): Promise<KeyObject> {
    let entry = await this.load();

    if (kid !== undefined) {
      const cached = entry.keys.get(kid);
      if (cached) return cached;

      if (this.canRefresh()) {
        this.options.logger.debug({ kid }, 'kid not in cached JWKS, refetching');
        this.invalidate();
        entry = await this.load();

        const refreshed = entry.keys.get(kid);
        if (refreshed) return refreshed;
      }

      throw new JwksError(
        'jwks_key_not_found',
        `No signing key with kid "${kid}" is published at ${this.jwksUri}`,
        { detail: { kid, availableKids: [...entry.keys.keys()] } },
      );
    }

    // A token without a `kid` is legal but ambiguous. Accept it only when the
    // provider publishes exactly one usable key, so there is no question which
    // key was meant. Guessing among several would let an attacker who controls
    // any one published key forge tokens.
    if (entry.anonymousKeys.length === 1 && entry.keys.size === 0) {
      return entry.anonymousKeys[0]!;
    }
    if (entry.keys.size === 1 && entry.anonymousKeys.length === 0) {
      return [...entry.keys.values()][0]!;
    }

    throw new JwksError(
      'jwks_key_not_found',
      'ID token has no "kid" header and the provider publishes more than one key, so the signing key is ambiguous',
      { detail: { keyCount: entry.keys.size + entry.anonymousKeys.length } },
    );
  }

  /** Drop cached keys. The next resolution refetches. */
  invalidate(): void {
    this.entry = undefined;
  }

  /** Seed the cache from a key set. Intended for tests and offline use. */
  seed(keySet: JsonWebKeySet, ttlMs = this.options.cacheTtlMs): void {
    this.entry = this.buildEntry(keySet, ttlMs);
  }

  /** Number of keys currently cached. Diagnostics only. */
  size(): number {
    if (!this.entry) return 0;
    return this.entry.keys.size + this.entry.anonymousKeys.length;
  }

  private canRefresh(): boolean {
    return Date.now() - this.lastRefreshAt >= JWKS_REFRESH_COOLDOWN_MS;
  }

  private async load(): Promise<CacheEntry> {
    const now = Date.now();

    if (this.entry && this.entry.expiresAt > now) {
      return this.entry;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.fetchKeys()
      .then((entry) => {
        this.entry = entry;
        this.lastRefreshAt = Date.now();
        return entry;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  private async fetchKeys(): Promise<CacheEntry> {
    this.options.logger.debug({ jwksUri: this.jwksUri }, 'Fetching JWKS');

    const response = await requestJson<JsonWebKeySet>(this.jwksUri, {
      method: 'GET',
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      fetch: this.options.fetch,
      logger: this.options.logger,
      operation: 'jwks',
    });

    if (response.status !== 200) {
      throw new JwksError('jwks_fetch_failed', `JWKS endpoint returned HTTP ${response.status}`, {
        detail: { jwksUri: this.jwksUri, status: response.status },
      });
    }

    return this.buildEntry(response.body, this.options.cacheTtlMs);
  }

  private buildEntry(keySet: unknown, ttlMs: number): CacheEntry {
    if (
      typeof keySet !== 'object' ||
      keySet === null ||
      !Array.isArray((keySet as JsonWebKeySet).keys)
    ) {
      throw new JwksError('jwks_invalid', 'JWKS response does not contain a "keys" array');
    }

    const keys = new Map<string, KeyObject>();
    const anonymousKeys: KeyObject[] = [];
    let skipped = 0;

    for (const jwk of (keySet as JsonWebKeySet).keys) {
      if (!isUsableSigningKey(jwk)) {
        skipped++;
        continue;
      }

      let keyObject: KeyObject;
      try {
        keyObject = createPublicKey({ key: jwk as never, format: 'jwk' });
      } catch (cause) {
        this.options.logger.warn(
          { kid: jwk.kid, reason: cause instanceof Error ? cause.message : String(cause) },
          'Skipping unusable JWK',
        );
        skipped++;
        continue;
      }

      if (jwk.kid) keys.set(jwk.kid, keyObject);
      else anonymousKeys.push(keyObject);
    }

    if (keys.size === 0 && anonymousKeys.length === 0) {
      throw new JwksError('jwks_invalid', 'JWKS contains no usable RSA signing keys', {
        detail: { skipped },
      });
    }

    this.options.logger.debug(
      { keyCount: keys.size + anonymousKeys.length, skipped },
      'Cached JWKS',
    );

    return { keys, anonymousKeys, expiresAt: Date.now() + ttlMs };
  }
}

/**
 * Whether a JWK can verify an RS256 signature.
 *
 * Keys explicitly marked for encryption (`use: "enc"`) are excluded: using an
 * encryption key to verify a signature is a category error, and providers
 * sometimes publish both in one set.
 */
export function isUsableSigningKey(jwk: JsonWebKey): boolean {
  if (jwk.kty !== 'RSA') return false;
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') return false;
  return typeof jwk.n === 'string' && typeof jwk.e === 'string';
}
