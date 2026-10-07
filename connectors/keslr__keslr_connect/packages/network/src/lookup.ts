/**
 * Address-to-member lookup against the Keslr IP lookup API.
 *
 * Keslr's coordination layer knows which member owns which node, and exposes
 * that mapping to registered OAuth clients. This module wraps it with the two
 * things a production service needs and the raw API does not provide: a cache,
 * and batching.
 *
 * Caching matters more than it might appear. Without it, a service that resolves
 * the caller's identity on every request issues one API call per request — which
 * both slows your service to the round-trip time of the lookup and makes your
 * traffic pattern Keslr's problem. Node ownership changes rarely; a short TTL is
 * plenty.
 */

import { LookupError } from './errors.js';
import type { NetworkIdentity, NetworkIdentityMap } from './types.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 5_000;
/** The API's ceiling for a single bulk request. */
const MAX_BULK_ADDRESSES = 500;

export interface IdentityLookupOptions {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: {
    debug(obj: Record<string, unknown>, msg?: string): void;
    warn(obj: Record<string, unknown>, msg?: string): void;
  };
}

interface CacheEntry {
  identity: NetworkIdentity | null;
  expiresAt: number;
}

/**
 * A single mapping as the API returns it.
 *
 * Note the shape: the single-address endpoint returns these fields at the top
 * level, not wrapped in a `data` envelope, and the bulk endpoint keys them under
 * `results`. The two differ, so they are parsed separately below.
 */
interface RawMapping {
  user_id?: string;
  username?: string;
  node_id?: string;
  online?: boolean;
  last_seen?: string;
  ip?: string;
  error?: string;
}

/** Raw response shape from `POST /api/network/ip-lookup/bulk`. */
interface RawBulkResponse {
  results?: Record<string, RawMapping | null>;
}

export class IdentityLookup {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<NetworkIdentity | null>>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly logger: NonNullable<IdentityLookupOptions['logger']>;
  private readonly authHeader?: string;

  constructor(options: IdentityLookupOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.logger = options.logger ?? { debug: () => undefined, warn: () => undefined };

    if (options.clientId && options.clientSecret) {
      this.authHeader = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`;
    }
  }

  /**
   * Resolve one address, using the cache where possible.
   *
   * Negative results are cached too. Without that, an unowned address — a
   * scanner, a misconfigured peer, anything hitting your service repeatedly from
   * outside the network — produces an API call per request, which is exactly the
   * traffic you least want to amplify.
   */
  async resolve(address: string): Promise<NetworkIdentity | null> {
    const cached = this.readCache(address);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(address);
    if (existing) return existing;

    this.logger.debug({ address }, 'Identity cache miss, querying Keslr');

    const promise = this.fetchOne(address)
      .then((identity) => {
        this.writeCache(address, identity);
        return identity;
      })
      .finally(() => {
        this.inFlight.delete(address);
      });

    this.inFlight.set(address, promise);
    return promise;
  }

  /**
   * Resolve many addresses, batching the ones that miss the cache.
   *
   * Requests are chunked to the API's per-call ceiling.
   */
  async resolveMany(addresses: string[]): Promise<NetworkIdentityMap> {
    const result: NetworkIdentityMap = {};
    const misses: string[] = [];

    for (const address of new Set(addresses)) {
      const cached = this.readCache(address);
      if (cached !== undefined) result[address] = cached;
      else misses.push(address);
    }

    for (let i = 0; i < misses.length; i += MAX_BULK_ADDRESSES) {
      const chunk = misses.slice(i, i + MAX_BULK_ADDRESSES);
      const resolved = await this.fetchBulk(chunk);

      for (const address of chunk) {
        const identity = resolved[address] ?? null;
        this.writeCache(address, identity);
        result[address] = identity;
      }
    }

    return result;
  }

  /** Empty the cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Number of cached entries, including negatives. */
  cacheSize(): number {
    return this.cache.size;
  }

  private readCache(address: string): NetworkIdentity | null | undefined {
    const entry = this.cache.get(address);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(address);
      return undefined;
    }

    return entry.identity;
  }

  private writeCache(address: string, identity: NetworkIdentity | null): void {
    if (this.cache.size >= this.maxCacheEntries) {
      // Simple FIFO eviction. An LRU would be marginally better, but this cache
      // is bounded, short-lived, and not on a hot enough path to justify one.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.set(address, { identity, expiresAt: Date.now() + this.cacheTtlMs });
  }

  private async fetchOne(address: string): Promise<NetworkIdentity | null> {
    const url = `${this.baseUrl}/api/network/ip-lookup?ip=${encodeURIComponent(address)}`;
    const response = await this.send(url, { method: 'GET' });

    // The API answers 404 for an address it has no mapping for. That is a
    // normal outcome, not an error.
    if (response.status === 404) return null;

    const body = await this.parse<RawMapping>(response);
    if (!body || !body.user_id) return null;

    return toIdentity(address, body);
  }

  private async fetchBulk(addresses: string[]): Promise<NetworkIdentityMap> {
    const url = `${this.baseUrl}/api/network/ip-lookup/bulk`;
    const response = await this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: addresses }),
    });

    const body = (await this.parse<RawBulkResponse>(response)) ?? {};
    const result: NetworkIdentityMap = {};

    for (const [address, mapping] of Object.entries(body.results ?? {})) {
      result[address] = mapping?.user_id ? toIdentity(address, mapping) : null;
    }

    return result;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (cause) {
      throw new LookupError('lookup_failed', `IP lookup request failed: ${describe(cause)}`, {
        cause,
        detail: { url },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(response: Response): Promise<T | null> {
    if (response.status === 401 || response.status === 403) {
      throw new LookupError(
        'lookup_unauthorized',
        'The IP lookup API rejected these client credentials. Check clientId and clientSecret, and that the client is authorized for network lookups.',
        { detail: { status: response.status } },
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new LookupError('lookup_failed', `IP lookup returned HTTP ${response.status}`, {
        detail: { status: response.status },
      });
    }

    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new LookupError('lookup_failed', 'IP lookup returned a body that is not valid JSON', {
        cause,
        detail: { bodyPreview: text.slice(0, 120) },
      });
    }
  }
}

function toIdentity(address: string, data: RawMapping): NetworkIdentity {
  return {
    userId: String(data.user_id ?? ''),
    username: String(data.username ?? ''),
    nodeId: data.node_id,
    online: data.online,
    lastSeen: parseTimestamp(data.last_seen),
    address,
  };
}

/**
 * Parse a `last_seen` timestamp, discarding zero values.
 *
 * The upstream source serialises "never seen" as a year-1 timestamp, which
 * `new Date()` turns into a real date. A UI given that renders "last seen 2000
 * years ago", so treat it as absent instead.
 */
function parseTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (parsed.getUTCFullYear() <= 1) return undefined;

  return parsed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
