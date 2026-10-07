import { describe, expect, it } from 'vitest';
import {
  assertMatchingSubject,
  assertVerified,
  describeVerificationStatus,
  isVerified,
  normalizeVerificationStatus,
  toKeslrUser,
} from '../src/claims.js';
import { NotVerifiedError } from '../src/errors.js';
import type { KeslrIdTokenClaims } from '../src/types.js';

const baseClaims: KeslrIdTokenClaims = {
  iss: 'https://id.keslr.test',
  sub: 'member-uuid',
  aud: 'client',
  exp: 2_000_000_000,
  iat: 1_900_000_000,
  email: 'member@keslr.test',
  email_verified: true,
  name: 'Test Member',
  preferred_username: 'testmember',
  keslr_id: 'KID-ABCDEFGHIJKL',
  verification_status: 'verified',
  verification_method: 'referral_approved',
};

describe('normalizeVerificationStatus', () => {
  it.each(['verified', 'pending_verification', 'unverified', 'rejected'])(
    'passes through the known status %s',
    (status) => {
      expect(normalizeVerificationStatus(status)).toBe(status);
    },
  );

  // Fail closed: an unknown status must never be treated as verified.
  it.each([
    ['an unknown future status', 'provisionally_trusted'],
    ['an empty string', ''],
    ['a near-miss with different case', 'Verified'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 1],
    ['an object', {}],
  ])('collapses %s to unverified', (_label, value) => {
    expect(normalizeVerificationStatus(value)).toBe('unverified');
  });
});

describe('toKeslrUser', () => {
  it('maps claims onto the normalised shape', () => {
    const user = toKeslrUser(baseClaims);

    expect(user).toMatchObject({
      id: 'member-uuid',
      keslrId: 'KID-ABCDEFGHIJKL',
      email: 'member@keslr.test',
      emailVerified: true,
      fullName: 'Test Member',
      username: 'testmember',
      verificationStatus: 'verified',
      verificationMethod: 'referral_approved',
      isVerified: true,
    });
  });

  it('lets UserInfo claims win over ID token claims', () => {
    const user = toKeslrUser(baseClaims, { name: 'Updated Name', sub: 'member-uuid' });
    expect(user.fullName).toBe('Updated Name');
  });

  // UserInfo must never be able to change who the token says authenticated.
  it('keeps the ID token subject even if UserInfo carries a different one', () => {
    const user = toKeslrUser(baseClaims, { sub: 'someone-else' });
    expect(user.id).toBe('member-uuid');
  });

  it('treats a missing verification_status as unverified', () => {
    const { verification_status: _omit, ...withoutStatus } = baseClaims;
    const user = toKeslrUser(withoutStatus as KeslrIdTokenClaims);

    expect(user.verificationStatus).toBe('unverified');
    expect(user.isVerified).toBe(false);
  });

  it('treats a missing email_verified as false', () => {
    const { email_verified: _omit, ...withoutFlag } = baseClaims;
    expect(toKeslrUser(withoutFlag as KeslrIdTokenClaims).emailVerified).toBe(false);
  });

  it('does not treat the string "true" as a verified email', () => {
    const user = toKeslrUser({ ...baseClaims, email_verified: 'true' as never });
    expect(user.emailVerified).toBe(false);
  });

  it('collapses empty-string claims to undefined', () => {
    const user = toKeslrUser({ ...baseClaims, keslr_id: '', name: '' });
    expect(user.keslrId).toBeUndefined();
    expect(user.fullName).toBeUndefined();
  });

  it('preserves unrecognised claims on raw', () => {
    const user = toKeslrUser({ ...baseClaims, some_future_claim: 'value' });
    expect(user.raw.some_future_claim).toBe('value');
  });
});

describe('assertVerified', () => {
  it('passes for a verified member', () => {
    expect(() => assertVerified(toKeslrUser(baseClaims))).not.toThrow();
  });

  it.each(['pending_verification', 'unverified', 'rejected'] as const)(
    'throws NotVerifiedError for status %s',
    (status) => {
      const user = toKeslrUser({ ...baseClaims, verification_status: status });
      expect(() => assertVerified(user)).toThrow(NotVerifiedError);
    },
  );

  it('carries the keslr id and status on the error', () => {
    const user = toKeslrUser({ ...baseClaims, verification_status: 'rejected' });

    try {
      assertVerified(user);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotVerifiedError);
      expect((error as NotVerifiedError).keslrId).toBe('KID-ABCDEFGHIJKL');
      expect((error as NotVerifiedError).verificationStatus).toBe('rejected');
      expect((error as NotVerifiedError).code).toBe('not_verified');
    }
  });
});

describe('isVerified', () => {
  it('is true for a verified member', () => {
    expect(isVerified(toKeslrUser(baseClaims))).toBe(true);
  });

  it('is false for an unverified member', () => {
    expect(isVerified(toKeslrUser({ ...baseClaims, verification_status: 'unverified' }))).toBe(
      false,
    );
  });

  it.each([[null], [undefined]])('is false for %s', (value) => {
    expect(isVerified(value)).toBe(false);
  });
});

describe('describeVerificationStatus', () => {
  it.each(['verified', 'pending_verification', 'unverified', 'rejected'] as const)(
    'returns a non-empty sentence for %s',
    (status) => {
      const text = describeVerificationStatus(status);
      expect(text.length).toBeGreaterThan(20);
      expect(text.endsWith('.')).toBe(true);
    },
  );

  it('mentions invitation for unverified members', () => {
    expect(describeVerificationStatus('unverified')).toMatch(/invitation/i);
  });
});

describe('assertMatchingSubject', () => {
  it('passes when the subjects match', () => {
    expect(() => assertMatchingSubject('member-uuid', { sub: 'member-uuid' })).not.toThrow();
  });

  it('throws when they differ', () => {
    expect(() => assertMatchingSubject('member-uuid', { sub: 'other' })).toThrow(/does not match/);
  });

  it('throws when UserInfo has no sub at all', () => {
    expect(() => assertMatchingSubject('member-uuid', {})).toThrow(/does not match/);
  });

  it('tags the error with a machine-readable code', () => {
    try {
      assertMatchingSubject('a', { sub: 'b' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('userinfo_subject_mismatch');
    }
  });
});
