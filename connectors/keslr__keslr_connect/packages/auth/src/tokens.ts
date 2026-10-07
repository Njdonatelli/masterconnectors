/**
 * ID token parsing and validation.
 *
 * This is the security core of the package. An ID token is the provider's signed
 * assertion about who a member is; if validation here is wrong, everything built
 * on top of it is wrong. The checks below implement OpenID Connect Core §3.1.3.7
 * in order, and each one exists because skipping it enables a specific attack:
 *
 * | Check      | Attack prevented if enforced                                    |
 * |------------|-----------------------------------------------------------------|
 * | `alg`      | `alg: "none"` forgery, and RS256/HS256 confusion                 |
 * | signature  | Wholesale token fabrication                                      |
 * | `iss`      | A different provider's token being accepted as Keslr's           |
 * | `aud`      | A token minted for a *different application* being replayed here |
 * | `exp`      | Indefinite reuse of a token after logout or revocation           |
 * | `nonce`    | Replay of a previously observed token into a fresh login         |
 *
 * The `alg` check deserves particular note. Historically the most damaging JWT
 * vulnerabilities came from libraries that trusted the `alg` header: an attacker
 * sets `alg: "none"` and strips the signature, or sets `alg: "HS256"` and signs
 * with the RSA *public* key as the HMAC secret — which the library then verifies
 * successfully, because it used the public key as a shared secret. We therefore
 * do not consult the header to choose an algorithm. RS256 is hard-coded, and any
 * token declaring anything else is rejected before a signature is computed.
 */

import { createVerify, timingSafeEqual, type KeyObject } from 'node:crypto';
import { decodeBase64Url, decodeBase64UrlToJson } from './base64url.js';
import { TokenValidationError } from './errors.js';
import type { KeslrIdTokenClaims } from './types.js';

/** The only signature algorithm this package accepts. */
export const SUPPORTED_ALGORITHM = 'RS256' as const;

/** Node's identifier for the RS256 digest. */
const NODE_DIGEST = 'RSA-SHA256';

export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
  [field: string]: unknown;
}

export interface DecodedJwt {
  header: JwtHeader;
  claims: KeslrIdTokenClaims;
  /** The `header.payload` portion, which is what the signature covers. */
  signingInput: string;
  signature: Buffer;
}

export interface ValidationOptions {
  /** Expected `iss`. Compared exactly. */
  issuer: string;
  /** Expected `aud` — your client ID. */
  audience: string;
  /** Expected `nonce`, from the authorization request. */
  nonce?: string;
  /** Clock skew tolerance in seconds. */
  clockToleranceSeconds: number;
  /** Injectable clock for tests. Returns milliseconds since the epoch. */
  now?: () => number;
  /** Reject tokens older than this many seconds, if set. */
  maxAgeSeconds?: number;
}

/**
 * Split and decode a JWT **without verifying it**.
 *
 * Exported because reading the `kid` header is a legitimate need before key
 * selection. The claims it returns are attacker-controlled until
 * {@link verifyIdToken} has run — never make a decision based on them.
 *
 * @throws {TokenValidationError} code `id_token_malformed`.
 */
export function decodeJwt(token: string): DecodedJwt {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TokenValidationError('id_token_malformed', 'ID token is empty');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenValidationError(
      'id_token_malformed',
      `ID token must have exactly 3 dot-separated segments (got ${parts.length})`,
    );
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  if (encodedSignature.length === 0) {
    // An empty signature segment is the shape produced by `alg: "none"`.
    throw new TokenValidationError('id_token_malformed', 'ID token has an empty signature segment');
  }

  let header: JwtHeader;
  try {
    header = decodeBase64UrlToJson<JwtHeader>(encodedHeader);
  } catch (cause) {
    throw new TokenValidationError('id_token_malformed', 'ID token header is not valid JSON', {
      cause,
    });
  }

  let claims: KeslrIdTokenClaims;
  try {
    claims = decodeBase64UrlToJson<KeslrIdTokenClaims>(encodedPayload);
  } catch (cause) {
    throw new TokenValidationError('id_token_malformed', 'ID token payload is not valid JSON', {
      cause,
    });
  }

  if (typeof header !== 'object' || header === null || typeof header.alg !== 'string') {
    throw new TokenValidationError('id_token_malformed', 'ID token header has no "alg" field');
  }

  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new TokenValidationError('id_token_malformed', 'ID token payload is not a JSON object');
  }

  let signature: Buffer;
  try {
    signature = decodeBase64Url(encodedSignature);
  } catch (cause) {
    throw new TokenValidationError(
      'id_token_malformed',
      'ID token signature is not valid base64url',
      { cause },
    );
  }

  return {
    header,
    claims,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature,
  };
}

/**
 * Verify the RSA signature over a decoded token.
 *
 * @throws {TokenValidationError} code `id_token_signature_invalid`.
 */
export function verifySignature(decoded: DecodedJwt, key: KeyObject): void {
  if (decoded.header.alg !== SUPPORTED_ALGORITHM) {
    throw new TokenValidationError(
      'id_token_signature_invalid',
      `ID token is signed with "${decoded.header.alg}" but only ${SUPPORTED_ALGORITHM} is accepted`,
      { detail: { alg: decoded.header.alg } },
    );
  }

  if (key.asymmetricKeyType !== 'rsa') {
    throw new TokenValidationError(
      'id_token_signature_invalid',
      `Signing key is ${key.asymmetricKeyType ?? 'of unknown type'}, expected rsa`,
    );
  }

  const verifier = createVerify(NODE_DIGEST);
  verifier.update(decoded.signingInput, 'ascii');
  verifier.end();

  if (!verifier.verify(key, decoded.signature)) {
    throw new TokenValidationError(
      'id_token_signature_invalid',
      'ID token signature does not match the provider signing key',
    );
  }
}

/**
 * Validate the claim set of an already signature-verified token.
 *
 * Call only after {@link verifySignature}. Validating claims on an unverified
 * token proves nothing — the claims are whatever the sender chose.
 *
 * @throws {TokenValidationError}
 */
export function validateClaims(claims: KeslrIdTokenClaims, options: ValidationOptions): void {
  const nowMs = (options.now ?? Date.now)();
  const nowSeconds = Math.floor(nowMs / 1000);
  const tolerance = options.clockToleranceSeconds;

  // -- iss ------------------------------------------------------------------
  if (typeof claims.iss !== 'string' || claims.iss.length === 0) {
    throw new TokenValidationError('id_token_claims_invalid', 'ID token has no "iss" claim');
  }
  if (claims.iss !== options.issuer) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      `ID token issuer "${claims.iss}" does not match expected "${options.issuer}"`,
      { detail: { actual: claims.iss, expected: options.issuer } },
    );
  }

  // -- sub ------------------------------------------------------------------
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new TokenValidationError('id_token_claims_invalid', 'ID token has no "sub" claim');
  }

  // -- aud ------------------------------------------------------------------
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length === 0 || audiences.some((entry) => typeof entry !== 'string')) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      'ID token has a malformed "aud" claim',
    );
  }
  if (!audiences.includes(options.audience)) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      `ID token audience [${audiences.join(', ')}] does not include this client`,
      { detail: { audiences, expected: options.audience } },
    );
  }

  // OIDC Core §3.1.3.7 rule 6: when `aud` has multiple values, `azp` must be
  // present and must name this client. Otherwise a token legitimately issued to
  // a *different* application that happens to also list us in `aud` would be
  // accepted here.
  if (audiences.length > 1) {
    if (typeof claims.azp !== 'string') {
      throw new TokenValidationError(
        'id_token_claims_invalid',
        'ID token has multiple audiences but no "azp" claim',
      );
    }
    if (claims.azp !== options.audience) {
      throw new TokenValidationError(
        'id_token_claims_invalid',
        `ID token authorized party "${claims.azp}" is not this client`,
        { detail: { azp: claims.azp, expected: options.audience } },
      );
    }
  }

  // -- exp ------------------------------------------------------------------
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      'ID token has no numeric "exp" claim',
    );
  }
  if (nowSeconds > claims.exp + tolerance) {
    throw new TokenValidationError(
      'id_token_expired',
      `ID token expired at ${new Date(claims.exp * 1000).toISOString()}`,
      { detail: { exp: claims.exp, now: nowSeconds, toleranceSeconds: tolerance } },
    );
  }

  // -- iat ------------------------------------------------------------------
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      'ID token has no numeric "iat" claim',
    );
  }
  if (claims.iat > nowSeconds + tolerance) {
    throw new TokenValidationError(
      'id_token_claims_invalid',
      'ID token was issued in the future, which indicates clock skew or forgery',
      { detail: { iat: claims.iat, now: nowSeconds, toleranceSeconds: tolerance } },
    );
  }
  if (
    options.maxAgeSeconds !== undefined &&
    nowSeconds - claims.iat > options.maxAgeSeconds + tolerance
  ) {
    throw new TokenValidationError(
      'id_token_expired',
      `ID token is older than the permitted maximum age of ${options.maxAgeSeconds}s`,
      { detail: { iat: claims.iat, now: nowSeconds, maxAgeSeconds: options.maxAgeSeconds } },
    );
  }

  // -- nbf ------------------------------------------------------------------
  if (claims.nbf !== undefined) {
    if (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf)) {
      throw new TokenValidationError(
        'id_token_claims_invalid',
        'ID token has a non-numeric "nbf" claim',
      );
    }
    if (nowSeconds + tolerance < claims.nbf) {
      throw new TokenValidationError(
        'id_token_claims_invalid',
        `ID token is not valid until ${new Date(claims.nbf * 1000).toISOString()}`,
        { detail: { nbf: claims.nbf, now: nowSeconds } },
      );
    }
  }

  // -- nonce ----------------------------------------------------------------
  if (options.nonce !== undefined) {
    if (typeof claims.nonce !== 'string') {
      throw new TokenValidationError(
        'nonce_mismatch',
        'A nonce was sent in the authorization request but the ID token has none',
      );
    }
    if (!constantTimeEquals(claims.nonce, options.nonce)) {
      throw new TokenValidationError(
        'nonce_mismatch',
        'ID token nonce does not match the value from the authorization request',
      );
    }
  }
}

/**
 * Decode, verify, and validate an ID token in one call.
 *
 * @param token - The raw compact JWT.
 * @param key - The provider public key, resolved by `kid`.
 * @param options - Validation parameters.
 * @returns The validated claim set.
 */
export function verifyIdToken(
  token: string,
  key: KeyObject,
  options: ValidationOptions,
): KeslrIdTokenClaims {
  const decoded = decodeJwt(token);
  verifySignature(decoded, key);
  validateClaims(decoded.claims, options);
  return decoded.claims;
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Lengths are compared first and short-circuit, which leaks only length — for
 * nonces and state values, both of which are fixed-length in this package, that
 * is not a meaningful disclosure.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
