/**
 * Public types for `@keslr/network`.
 */

/**
 * The Keslr member behind a network address.
 *
 * Returned by the address lookup API. Note the distinction from an OIDC login:
 * this tells you which member owns the device that opened the connection,
 * without that member having signed in to your application at all.
 */
export interface NetworkIdentity {
  /**
   * Keslr's internal user UUID.
   *
   * The same value as the `sub` claim from `@keslr/auth`, so an application
   * using both can join on it directly.
   */
  userId: string;
  username: string;
  /** Identifier of the device, when the network reports one. */
  nodeId?: string;
  /** Whether the device was connected at lookup time. */
  online?: boolean;
  lastSeen?: Date;
  /** The address that was resolved. */
  address: string;
}

/** A batch lookup result. Addresses with no owner map to `null`. */
export type NetworkIdentityMap = Record<string, NetworkIdentity | null>;

/** Minimal structured logger. Compatible with pino, bunyan, and console. */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** The subset of `fetch` this package relies on. Inject to test or to proxy. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
