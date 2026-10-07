/**
 * Error hierarchy for `@keslr/network`.
 *
 * As in `@keslr/auth`, match on `code` rather than on messages or subclasses.
 */

export type KeslrNetworkErrorCode =
  'lookup_failed' | 'lookup_unauthorized' | 'configuration_invalid' | 'identity_unknown';

export interface KeslrNetworkErrorOptions {
  cause?: unknown;
  detail?: Record<string, unknown>;
}

export class KeslrNetworkError extends Error {
  readonly code: KeslrNetworkErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(
    code: KeslrNetworkErrorCode,
    message: string,
    options: KeslrNetworkErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'KeslrNetworkError';
    this.code = code;
    this.detail = options.detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/** An address lookup failed. */
export class LookupError extends KeslrNetworkError {
  constructor(
    code: Extract<KeslrNetworkErrorCode, 'lookup_failed' | 'lookup_unauthorized'>,
    message: string,
    options: KeslrNetworkErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'LookupError';
  }
}

/**
 * A request arrived from an address with no known Keslr member.
 *
 * Thrown by the strict form of the identity middleware. In practice this means
 * one of: the request came from outside the Keslr network entirely; the device
 * joined more recently than the lookup cache; or your service is listening on a
 * public interface it should not be.
 *
 * That last case is the one worth checking first. A service intended to be
 * reachable only by members should bind to its Keslr address, not `0.0.0.0`.
 */
export class IdentityUnknownError extends KeslrNetworkError {
  readonly address: string;

  constructor(address: string, options: KeslrNetworkErrorOptions = {}) {
    super('identity_unknown', `No Keslr member is associated with the address ${address}`, {
      ...options,
      detail: { address, ...options.detail },
    });
    this.name = 'IdentityUnknownError';
    this.address = address;
  }
}

export function isKeslrNetworkError(
  value: unknown,
  code?: KeslrNetworkErrorCode,
): value is KeslrNetworkError {
  if (!(value instanceof KeslrNetworkError)) return false;
  return code === undefined || value.code === code;
}
