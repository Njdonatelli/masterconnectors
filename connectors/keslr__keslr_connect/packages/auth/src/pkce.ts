/**
 * PKCE — Proof Key for Code Exchange (RFC 7636).
 *
 * PKCE binds an authorization code to the client that requested it. Without it,
 * an attacker who intercepts a code (through a redirect leak, a malicious app
 * registered for your custom URL scheme, or a referrer header) can redeem it
 * themselves. With it, redemption additionally requires the `code_verifier`,
 * which never leaves your server.
 *
 * Keslr requires PKCE with the `S256` challenge method for public clients and
 * accepts it for confidential clients. This package always sends it. There is no
 * option to disable it, and `plain` is deliberately not implemented — it offers
 * no protection against an attacker who can see the authorization request.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { encodeBase64Url } from './base64url.js';

/** The only challenge method this package supports. */
export const CODE_CHALLENGE_METHOD = 'S256' as const;

/**
 * RFC 7636 §4.1 permits verifiers of 43–128 characters. We generate 43, which is
 * exactly 32 bytes of entropy after base64url encoding — comfortably beyond what
 * any attacker can search, and short enough to stay well inside URL length
 * limits on the platforms that still have them.
 */
const VERIFIER_ENTROPY_BYTES = 32;

const MIN_VERIFIER_LENGTH = 43;
const MAX_VERIFIER_LENGTH = 128;

/** The unreserved character set a verifier is allowed to use, per RFC 7636 §4.1. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export interface PkcePair {
  /** The secret. Store server-side; never send to the browser or log it. */
  codeVerifier: string;
  /** The public challenge, derived as base64url(SHA-256(verifier)). */
  codeChallenge: string;
  /** Always `S256`. */
  codeChallengeMethod: typeof CODE_CHALLENGE_METHOD;
}

/**
 * Generate a cryptographically random `code_verifier`.
 *
 * Uses `crypto.randomBytes`, which draws from the platform CSPRNG. Never
 * substitute `Math.random()` here — it is seeded predictably and an attacker who
 * recovers the seed recovers every verifier you will ever generate.
 */
export function generateCodeVerifier(): string {
  return encodeBase64Url(randomBytes(VERIFIER_ENTROPY_BYTES));
}

/**
 * Derive the `code_challenge` for a verifier.
 *
 * @throws {TypeError} if the verifier does not satisfy RFC 7636 §4.1.
 */
export function deriveCodeChallenge(codeVerifier: string): string {
  assertValidCodeVerifier(codeVerifier);
  return encodeBase64Url(createHash('sha256').update(codeVerifier, 'ascii').digest());
}

/** Generate a matched verifier/challenge pair. */
export function createPkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    codeChallengeMethod: CODE_CHALLENGE_METHOD,
  };
}

/**
 * Validate a verifier against RFC 7636 §4.1.
 *
 * @throws {TypeError} with a message naming the specific rule violated.
 */
export function assertValidCodeVerifier(codeVerifier: unknown): asserts codeVerifier is string {
  if (typeof codeVerifier !== 'string') {
    throw new TypeError('code_verifier must be a string');
  }
  if (codeVerifier.length < MIN_VERIFIER_LENGTH) {
    throw new TypeError(
      `code_verifier must be at least ${MIN_VERIFIER_LENGTH} characters (got ${codeVerifier.length})`,
    );
  }
  if (codeVerifier.length > MAX_VERIFIER_LENGTH) {
    throw new TypeError(
      `code_verifier must be at most ${MAX_VERIFIER_LENGTH} characters (got ${codeVerifier.length})`,
    );
  }
  if (!VERIFIER_PATTERN.test(codeVerifier)) {
    throw new TypeError(
      'code_verifier may only contain unreserved characters: A-Z a-z 0-9 - . _ ~',
    );
  }
}

/**
 * Verify a verifier against a challenge in constant time.
 *
 * Provided for completeness and for tests. A relying party does not normally
 * need this — the authorization server performs the check. Comparison is
 * timing-safe so that use in a server context cannot leak the challenge through
 * response timing.
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  let derived: string;
  try {
    derived = deriveCodeChallenge(codeVerifier);
  } catch {
    return false;
  }

  const a = Buffer.from(derived, 'utf8');
  const b = Buffer.from(codeChallenge, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
