/**
 * Error hierarchy for `@keslr/auth`.
 *
 * Every error thrown by this package extends {@link KeslrAuthError} and carries a
 * stable, machine-readable `code`. Match on `code` rather than on error messages
 * or `instanceof` checks against subclasses — messages are tuned for humans and
 * may change in any release, whereas codes are part of the public API and change
 * only on a major version.
 */

/** Stable, machine-readable identifiers for every failure mode in this package. */
export type KeslrAuthErrorCode =
  | 'configuration_invalid'
  | 'discovery_failed'
  | 'discovery_invalid'
  | 'network_error'
  | 'timeout'
  | 'jwks_fetch_failed'
  | 'jwks_key_not_found'
  | 'jwks_invalid'
  | 'token_request_failed'
  | 'token_response_invalid'
  | 'id_token_malformed'
  | 'id_token_signature_invalid'
  | 'id_token_claims_invalid'
  | 'id_token_expired'
  | 'nonce_mismatch'
  | 'state_mismatch'
  | 'userinfo_failed'
  | 'userinfo_subject_mismatch'
  | 'not_verified'
  | 'provider_error';

export interface KeslrAuthErrorOptions {
  /** Underlying error, preserved for logging. Never surfaced to end users. */
  cause?: unknown;
  /** Structured detail safe to log. Must not contain tokens or secrets. */
  detail?: Record<string, unknown>;
}

/**
 * Base class for every error raised by `@keslr/auth`.
 *
 * @example
 * ```ts
 * try {
 *   await client.exchangeCode(params);
 * } catch (err) {
 *   if (err instanceof KeslrAuthError && err.code === 'state_mismatch') {
 *     return res.redirect('/login?error=expired');
 *   }
 *   throw err;
 * }
 * ```
 */
export class KeslrAuthError extends Error {
  readonly code: KeslrAuthErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: KeslrAuthErrorCode, message: string, options: KeslrAuthErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'KeslrAuthError';
    this.code = code;
    this.detail = options.detail;

    // Restore the prototype chain, which is severed when the compile target is
    // ES5 and Error is subclassed. Harmless on modern targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * A representation safe to write to logs: no tokens, no client secret, no
   * authorization codes. `detail` is included on the assumption that callers
   * within this package never place credentials there.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/** The client was constructed with options that cannot produce a valid flow. */
export class ConfigurationError extends KeslrAuthError {
  constructor(message: string, options: KeslrAuthErrorOptions = {}) {
    super('configuration_invalid', message, options);
    this.name = 'ConfigurationError';
  }
}

/** A network call failed, timed out, or returned an unusable response. */
export class TransportError extends KeslrAuthError {
  /** HTTP status, when the failure came from a response rather than a socket. */
  readonly status?: number;

  constructor(
    code: Extract<KeslrAuthErrorCode, 'network_error' | 'timeout'>,
    message: string,
    options: KeslrAuthErrorOptions & { status?: number } = {},
  ) {
    super(code, message, options);
    this.name = 'TransportError';
    this.status = options.status;
  }
}

/** Provider discovery failed or returned a document missing required fields. */
export class DiscoveryError extends KeslrAuthError {
  constructor(
    code: Extract<KeslrAuthErrorCode, 'discovery_failed' | 'discovery_invalid'>,
    message: string,
    options: KeslrAuthErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'DiscoveryError';
  }
}

/** The JWKS could not be fetched, parsed, or did not contain the required key. */
export class JwksError extends KeslrAuthError {
  constructor(
    code: Extract<KeslrAuthErrorCode, 'jwks_fetch_failed' | 'jwks_key_not_found' | 'jwks_invalid'>,
    message: string,
    options: KeslrAuthErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'JwksError';
  }
}

/**
 * An ID token failed validation.
 *
 * Treat every one of these as an authentication failure. Do not retry, and do
 * not fall back to trusting unverified claims — a token that fails validation
 * carries no trustworthy information at all.
 */
export class TokenValidationError extends KeslrAuthError {
  constructor(
    code: Extract<
      KeslrAuthErrorCode,
      | 'id_token_malformed'
      | 'id_token_signature_invalid'
      | 'id_token_claims_invalid'
      | 'id_token_expired'
      | 'nonce_mismatch'
      | 'token_response_invalid'
    >,
    message: string,
    options: KeslrAuthErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'TokenValidationError';
  }
}

/**
 * The authorization server returned an OAuth 2.0 error response.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2
 */
export class ProviderError extends KeslrAuthError {
  /** The `error` field from the provider, e.g. `invalid_grant`. */
  readonly oauthError: string;
  /** The `error_description` field, when present. */
  readonly oauthErrorDescription?: string;

  constructor(
    oauthError: string,
    oauthErrorDescription: string | undefined,
    options: KeslrAuthErrorOptions & { status?: number } = {},
  ) {
    const suffix = oauthErrorDescription ? `: ${oauthErrorDescription}` : '';
    super('provider_error', `Keslr returned "${oauthError}"${suffix}`, options);
    this.name = 'ProviderError';
    this.oauthError = oauthError;
    this.oauthErrorDescription = oauthErrorDescription;
  }
}

/**
 * Authentication succeeded, but the member is not verified.
 *
 * This is an authorization outcome, not a failure of the protocol. The member is
 * who they say they are; they have simply not completed verification, so their
 * `verification_status` is not `verified`. Applications that only serve verified
 * humans should present this as "your Keslr account isn't verified yet" rather
 * than as a login error.
 */
export class NotVerifiedError extends KeslrAuthError {
  readonly keslrId: string;
  readonly verificationStatus: string;

  constructor(keslrId: string, verificationStatus: string, options: KeslrAuthErrorOptions = {}) {
    super(
      'not_verified',
      `Keslr member ${keslrId} has verification_status "${verificationStatus}", expected "verified"`,
      { ...options, detail: { keslrId, verificationStatus, ...options.detail } },
    );
    this.name = 'NotVerifiedError';
    this.keslrId = keslrId;
    this.verificationStatus = verificationStatus;
  }
}

/** True when `value` is a {@link KeslrAuthError} carrying the given code. */
export function isKeslrAuthError(
  value: unknown,
  code?: KeslrAuthErrorCode,
): value is KeslrAuthError {
  if (!(value instanceof KeslrAuthError)) return false;
  return code === undefined || value.code === code;
}
