/**
 * OpenID Connect Discovery (OIDC Discovery 1.0 §4).
 *
 * Rather than hard-coding endpoint paths, we fetch the provider's metadata
 * document once and cache it. This means Keslr can move an endpoint without
 * breaking every integration, and it means this package validates that the
 * provider is actually configured the way the flow requires.
 */

import { DiscoveryError } from './errors.js';
import { requestJson } from './http.js';
import type { DiscoveryDocument, FetchLike, Logger } from './types.js';

/** The well-known path defined by the specification. Not configurable. */
export const DISCOVERY_PATH = '/.well-known/openid-configuration';

/** Fields without which the authorization code flow cannot proceed. */
const REQUIRED_FIELDS = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const;

export interface DiscoveryOptions {
  issuer: string;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  fetch: FetchLike;
  logger: Logger;
}

interface CacheEntry {
  document: DiscoveryDocument;
  expiresAt: number;
}

/**
 * Build the discovery URL for an issuer.
 *
 * Per the specification the well-known path is appended to the issuer including
 * any path component, so `https://api.keslr.com/tenant/a` resolves to
 * `https://api.keslr.com/tenant/a/.well-known/openid-configuration`. A trailing
 * slash on the issuer is tolerated here, but note that it is *not* tolerated
 * when comparing the `iss` claim — that comparison is exact, by design.
 */
export function buildDiscoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}${DISCOVERY_PATH}`;
}

/**
 * Fetches and caches the provider metadata document.
 *
 * A single in-flight fetch is shared between concurrent callers. Without this,
 * a cold cache under load produces one discovery request per concurrent login,
 * which is both wasteful and a fine way to get rate-limited during exactly the
 * traffic spike that emptied the cache.
 */
export class DiscoveryCache {
  private entry?: CacheEntry;
  private inFlight?: Promise<DiscoveryDocument>;

  constructor(private readonly options: DiscoveryOptions) {}

  /** Return the cached document, fetching it if absent or stale. */
  async get(): Promise<DiscoveryDocument> {
    const now = Date.now();

    if (this.entry && this.entry.expiresAt > now) {
      return this.entry.document;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.fetchDocument()
      .then((document) => {
        this.entry = { document, expiresAt: Date.now() + this.options.cacheTtlMs };
        return document;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  /** Drop the cached document. The next `get()` refetches. */
  invalidate(): void {
    this.entry = undefined;
  }

  /** Seed the cache. Intended for tests and for offline bootstrapping. */
  seed(document: DiscoveryDocument, ttlMs = this.options.cacheTtlMs): void {
    assertValidDiscoveryDocument(document, this.options.issuer);
    this.entry = { document, expiresAt: Date.now() + ttlMs };
  }

  private async fetchDocument(): Promise<DiscoveryDocument> {
    const url = buildDiscoveryUrl(this.options.issuer);
    this.options.logger.debug({ url }, 'Fetching OpenID configuration');

    const response = await requestJson<DiscoveryDocument>(url, {
      method: 'GET',
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      fetch: this.options.fetch,
      logger: this.options.logger,
      operation: 'discovery',
    });

    if (response.status !== 200) {
      throw new DiscoveryError(
        'discovery_failed',
        `Discovery returned HTTP ${response.status} for ${url}`,
        { detail: { url, status: response.status } },
      );
    }

    assertValidDiscoveryDocument(response.body, this.options.issuer);
    this.options.logger.debug({ issuer: response.body.issuer }, 'Loaded OpenID configuration');

    return response.body;
  }
}

/**
 * Validate a metadata document.
 *
 * The issuer check is the security-relevant one. OIDC Discovery §4.3 requires
 * that the `issuer` in the document exactly equal the issuer used to fetch it;
 * a mismatch means you may be talking to a provider impersonating another, and
 * every downstream `iss` validation would then pass against the wrong identity.
 *
 * @throws {DiscoveryError} with code `discovery_invalid`.
 */
export function assertValidDiscoveryDocument(
  document: unknown,
  expectedIssuer: string,
): asserts document is DiscoveryDocument {
  if (typeof document !== 'object' || document === null) {
    throw new DiscoveryError('discovery_invalid', 'Discovery document is not a JSON object');
  }

  const record = document as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new DiscoveryError(
        'discovery_invalid',
        `Discovery document is missing the required "${field}" field`,
        { detail: { field } },
      );
    }
  }

  const normalisedExpected = expectedIssuer.replace(/\/+$/, '');
  const normalisedActual = String(record.issuer).replace(/\/+$/, '');

  if (normalisedActual !== normalisedExpected) {
    throw new DiscoveryError(
      'discovery_invalid',
      `Discovery issuer mismatch: document declares "${record.issuer}" but was fetched from "${expectedIssuer}"`,
      { detail: { declared: record.issuer, expected: expectedIssuer } },
    );
  }

  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    const value = String(record[field]);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new DiscoveryError(
        'discovery_invalid',
        `Discovery field "${field}" is not an absolute URL: ${value}`,
        { detail: { field, value } },
      );
    }

    // Refuse plaintext endpoints outside local development. An ID token fetched
    // over http: can be swapped in transit, which defeats the entire flow.
    if (parsed.protocol !== 'https:' && !isLoopback(parsed.hostname)) {
      throw new DiscoveryError(
        'discovery_invalid',
        `Discovery field "${field}" must use https (got "${parsed.protocol}")`,
        { detail: { field, value } },
      );
    }
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
