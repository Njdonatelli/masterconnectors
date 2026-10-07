/**
 * Claim normalisation and verification-status helpers.
 *
 * Applications should not be reading raw claim names or comparing status strings
 * by hand. `verification_status === 'verified'` is easy to write and easy to
 * write *wrong* — a typo, a stale enum, a `!==` where `===` was meant — and each
 * mistake fails open, admitting members you meant to exclude. Normalising once,
 * here, means every call site downstream reads a boolean.
 */

import { NotVerifiedError } from './errors.js';
import type {
  KeslrIdTokenClaims,
  KeslrUser,
  VerificationMethod,
  VerificationStatus,
} from './types.js';

/** Every status Keslr currently issues. */
export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'verified',
  'pending_verification',
  'unverified',
  'rejected',
] as const;

/**
 * Coerce an arbitrary claim value into a {@link VerificationStatus}.
 *
 * Unrecognised values collapse to `unverified` rather than throwing. This fails
 * *closed*: if Keslr introduces a status this release has never heard of, an
 * application gating on `isVerified` denies access rather than accidentally
 * granting it. Denying a legitimate member is a bug you hear about; admitting an
 * illegitimate one is a bug you don't.
 */
export function normalizeVerificationStatus(value: unknown): VerificationStatus {
  return typeof value === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(value)
    ? (value as VerificationStatus)
    : 'unverified';
}

/**
 * Build a {@link KeslrUser} from ID token claims, optionally merged with
 * UserInfo claims.
 *
 * UserInfo takes precedence where the two disagree — it is fetched later and is
 * therefore fresher. The `sub` claim is the exception: it comes from the ID
 * token, and a UserInfo response whose `sub` differs is a spec violation that
 * {@link assertMatchingSubject} rejects before this function is reached.
 */
export function toKeslrUser(
  idTokenClaims: KeslrIdTokenClaims,
  userInfoClaims?: Record<string, unknown>,
): KeslrUser {
  const merged: KeslrIdTokenClaims = {
    ...idTokenClaims,
    ...(userInfoClaims ?? {}),
  } as KeslrIdTokenClaims;

  // `sub` is authoritative from the ID token; never let UserInfo override it.
  merged.sub = idTokenClaims.sub;

  const verificationStatus = normalizeVerificationStatus(merged.verification_status);

  return {
    id: merged.sub,
    keslrId: asOptionalString(merged.keslr_id),
    email: asOptionalString(merged.email),
    emailVerified: merged.email_verified === true,
    fullName: asOptionalString(merged.name),
    username: asOptionalString(merged.preferred_username),
    verificationStatus,
    verificationMethod: asOptionalString(merged.verification_method) as
      VerificationMethod | undefined,
    isVerified: verificationStatus === 'verified',
    raw: merged,
  };
}

/**
 * Assert that a member is verified.
 *
 * Use at trust boundaries where an unverified member must not proceed.
 *
 * @throws {NotVerifiedError} when the member is not verified.
 *
 * @example
 * ```ts
 * const { user } = await client.exchangeCode(params);
 * assertVerified(user); // throws unless user.isVerified
 * await db.posts.insert({ authorId: user.id, body });
 * ```
 */
export function assertVerified(user: KeslrUser): asserts user is KeslrUser & { isVerified: true } {
  if (!user.isVerified) {
    throw new NotVerifiedError(user.keslrId ?? user.id, user.verificationStatus);
  }
}

/** Non-throwing counterpart to {@link assertVerified}. */
export function isVerified(user: KeslrUser | null | undefined): boolean {
  return user?.isVerified === true;
}

/**
 * A short, human-readable explanation of why a member is not verified, suitable
 * for showing in a UI.
 */
export function describeVerificationStatus(status: VerificationStatus): string {
  switch (status) {
    case 'verified':
      return 'This member is a verified human on the Keslr network.';
    case 'pending_verification':
      return 'This member has requested verification and is awaiting a decision.';
    case 'rejected':
      return 'This member attempted verification and was not approved.';
    case 'unverified':
    default:
      return 'This member has not been verified. Keslr membership is granted by invitation from an existing verified member.';
  }
}

/**
 * Validate that a UserInfo response describes the same subject as the ID token.
 *
 * OpenID Connect Core §5.3.2 requires this check. Without it, an attacker who
 * can influence the UserInfo response — through a compromised token, a proxy, or
 * a provider-side bug — could substitute a different member's profile while your
 * application continues to believe the ID token's subject authenticated.
 *
 * @throws {Error} tagged with code `userinfo_subject_mismatch`.
 */
export function assertMatchingSubject(
  idTokenSubject: string,
  userInfoClaims: Record<string, unknown>,
): void {
  const subject = userInfoClaims.sub;
  if (typeof subject !== 'string' || subject !== idTokenSubject) {
    const error = new Error(
      `UserInfo subject "${String(subject)}" does not match ID token subject "${idTokenSubject}"`,
    );
    Object.assign(error, { code: 'userinfo_subject_mismatch' });
    throw error;
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
