/**
 * ID token validation tests.
 *
 * These are the tests that matter most in the package. Each case corresponds to
 * an attack that succeeds if the check under test is removed, and the suite is
 * written so that deleting any single validation in `tokens.ts` turns at least
 * one of these red.
 */

import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  decodeJwt,
  validateClaims,
  verifyIdToken,
  verifySignature,
} from '../src/tokens.js';
import { KeslrAuthError, TokenValidationError } from '../src/errors.js';
import {
  createTestKey,
  forgeUnsignedToken,
  signIdToken,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from './helpers/keys.js';

const key = createTestKey();
const otherKey = createTestKey('attacker-key');

const baseValidation = {
  issuer: TEST_ISSUER,
  audience: TEST_CLIENT_ID,
  clockToleranceSeconds: 60,
};

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KeslrAuthError);
    expect((error as KeslrAuthError).code).toBe(code);
    return;
  }
  throw new Error(`Expected a KeslrAuthError with code "${code}" but nothing was thrown`);
}

describe('decodeJwt', () => {
  it('decodes a well-formed token', () => {
    const token = signIdToken({ key, claims: {} });
    const decoded = decodeJwt(token);

    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBe(key.kid);
    expect(decoded.claims.iss).toBe(TEST_ISSUER);
    expect(decoded.claims.keslr_id).toBe('KID-TESTTESTTEST');
    expect(decoded.signature.length).toBeGreaterThan(0);
  });

  it.each([
    ['an empty string', ''],
    ['two segments', 'aaa.bbb'],
    ['four segments', 'aaa.bbb.ccc.ddd'],
  ])('rejects %s', (_label, token) => {
    expectCode(() => decodeJwt(token), 'id_token_malformed');
  });

  it('rejects a token with an empty signature segment', () => {
    expectCode(() => decodeJwt(forgeUnsignedToken()), 'id_token_malformed');
  });

  it('rejects a header that is not JSON', () => {
    expectCode(() => decodeJwt('bm90LWpzb24.eyJhIjoxfQ.c2ln'), 'id_token_malformed');
  });

  it('rejects a payload that is a JSON array rather than an object', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
    expectCode(() => decodeJwt(`${header}.${payload}.c2ln`), 'id_token_malformed');
  });
});

describe('verifySignature', () => {
  it('accepts a signature made by the matching key', () => {
    const decoded = decodeJwt(signIdToken({ key, claims: {} }));
    expect(() => verifySignature(decoded, key.publicKey)).not.toThrow();
  });

  it('rejects a signature made by a different key', () => {
    const decoded = decodeJwt(signIdToken({ key: otherKey, claims: {} }));
    expectCode(() => verifySignature(decoded, key.publicKey), 'id_token_signature_invalid');
  });

  it('rejects a corrupted signature', () => {
    const decoded = decodeJwt(signIdToken({ key, claims: {}, corruptSignature: true }));
    expectCode(() => verifySignature(decoded, key.publicKey), 'id_token_signature_invalid');
  });

  // The historically most damaging JWT bug: trusting the `alg` header.
  it('rejects alg: "none" before doing any signature work', () => {
    const token = forgeUnsignedToken();
    // decodeJwt rejects the empty signature first, so construct one with a
    // non-empty (but meaningless) signature segment to reach verifySignature.
    const [header, payload] = token.split('.');
    const decoded = decodeJwt(`${header}.${payload}.${Buffer.from('x').toString('base64url')}`);
    expectCode(() => verifySignature(decoded, key.publicKey), 'id_token_signature_invalid');
  });

  it('rejects an HS256 header even when the payload is otherwise valid', () => {
    const decoded = decodeJwt(signIdToken({ key, claims: {}, algHeader: 'HS256' }));
    expectCode(() => verifySignature(decoded, key.publicKey), 'id_token_signature_invalid');
  });

  it('rejects RS512 — only RS256 is accepted', () => {
    const decoded = decodeJwt(signIdToken({ key, claims: {}, algHeader: 'RS512' }));
    expectCode(() => verifySignature(decoded, key.publicKey), 'id_token_signature_invalid');
  });
});

describe('validateClaims', () => {
  const now = () => 1_800_000_000_000; // fixed clock, ms
  const nowSeconds = 1_800_000_000;

  const validClaims = {
    iss: TEST_ISSUER,
    sub: 'member-1',
    aud: TEST_CLIENT_ID,
    exp: nowSeconds + 3600,
    iat: nowSeconds - 10,
  };

  it('accepts a valid claim set', () => {
    expect(() => validateClaims(validClaims, { ...baseValidation, now })).not.toThrow();
  });

  it('rejects a token from a different issuer', () => {
    expectCode(
      () =>
        validateClaims({ ...validClaims, iss: 'https://evil.example' }, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  it('rejects an issuer that differs only by trailing slash', () => {
    // Exact comparison is required by the spec; a normalising comparison here
    // would accept issuers the provider never asserted.
    expectCode(
      () => validateClaims({ ...validClaims, iss: `${TEST_ISSUER}/` }, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  it('rejects a token minted for another application', () => {
    expectCode(
      () => validateClaims({ ...validClaims, aud: 'some-other-app' }, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  it('accepts an aud array that contains this client', () => {
    expect(() =>
      validateClaims(
        { ...validClaims, aud: ['another-app', TEST_CLIENT_ID], azp: TEST_CLIENT_ID },
        { ...baseValidation, now },
      ),
    ).not.toThrow();
  });

  it('rejects a multi-audience token with no azp', () => {
    expectCode(
      () =>
        validateClaims(
          { ...validClaims, aud: ['another-app', TEST_CLIENT_ID] },
          { ...baseValidation, now },
        ),
      'id_token_claims_invalid',
    );
  });

  it('rejects a multi-audience token whose azp names another client', () => {
    expectCode(
      () =>
        validateClaims(
          { ...validClaims, aud: ['another-app', TEST_CLIENT_ID], azp: 'another-app' },
          { ...baseValidation, now },
        ),
      'id_token_claims_invalid',
    );
  });

  it('rejects an expired token', () => {
    expectCode(
      () => validateClaims({ ...validClaims, exp: nowSeconds - 120 }, { ...baseValidation, now }),
      'id_token_expired',
    );
  });

  it('accepts a token expired within the clock tolerance', () => {
    expect(() =>
      validateClaims({ ...validClaims, exp: nowSeconds - 30 }, { ...baseValidation, now }),
    ).not.toThrow();
  });

  it('rejects a token issued in the future beyond tolerance', () => {
    expectCode(
      () => validateClaims({ ...validClaims, iat: nowSeconds + 600 }, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  it('rejects a token whose nbf has not arrived', () => {
    expectCode(
      () => validateClaims({ ...validClaims, nbf: nowSeconds + 600 }, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  it('enforces maxAgeSeconds when supplied', () => {
    expectCode(
      () =>
        validateClaims(
          { ...validClaims, iat: nowSeconds - 7200 },
          { ...baseValidation, now, maxAgeSeconds: 3600 },
        ),
      'id_token_expired',
    );
  });

  it('rejects a missing sub', () => {
    const { sub: _sub, ...withoutSub } = validClaims;
    expectCode(
      () => validateClaims(withoutSub as never, { ...baseValidation, now }),
      'id_token_claims_invalid',
    );
  });

  describe('nonce', () => {
    it('accepts a matching nonce', () => {
      expect(() =>
        validateClaims(
          { ...validClaims, nonce: 'abc123' },
          { ...baseValidation, now, nonce: 'abc123' },
        ),
      ).not.toThrow();
    });

    it('rejects a mismatched nonce', () => {
      expectCode(
        () =>
          validateClaims(
            { ...validClaims, nonce: 'wrong' },
            { ...baseValidation, now, nonce: 'abc123' },
          ),
        'nonce_mismatch',
      );
    });

    it('rejects a token with no nonce when one was requested', () => {
      expectCode(
        () => validateClaims(validClaims, { ...baseValidation, now, nonce: 'abc123' }),
        'nonce_mismatch',
      );
    });

    it('ignores the nonce claim when none was requested', () => {
      expect(() =>
        validateClaims({ ...validClaims, nonce: 'whatever' }, { ...baseValidation, now }),
      ).not.toThrow();
    });
  });
});

describe('verifyIdToken', () => {
  it('returns claims for a fully valid token', () => {
    const token = signIdToken({ key, claims: { nonce: 'n-1' } });
    const claims = verifyIdToken(token, key.publicKey, { ...baseValidation, nonce: 'n-1' });

    expect(claims.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(claims.verification_status).toBe('verified');
  });

  it('rejects a token signed by an attacker key even if every claim is correct', () => {
    const token = signIdToken({ key: otherKey, claims: {} });
    expect(() => verifyIdToken(token, key.publicKey, baseValidation)).toThrow(TokenValidationError);
  });

  it('checks the signature before the claims', () => {
    // An expired token signed by the wrong key should report the signature
    // problem, not the expiry — otherwise an attacker learns which of their
    // forgery attempts got closest.
    const token = signIdToken({
      key: otherKey,
      claims: { exp: Math.floor(Date.now() / 1000) - 9999 },
    });
    expectCode(
      () => verifyIdToken(token, key.publicKey, baseValidation),
      'id_token_signature_invalid',
    );
  });
});

describe('constantTimeEquals', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('hello world', 'hello world')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(constantTimeEquals('hello world', 'hello w0rld')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(constantTimeEquals('short', 'considerably longer')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });

  it('handles multi-byte characters by comparing bytes', () => {
    expect(constantTimeEquals('café', 'café')).toBe(true);
    expect(constantTimeEquals('café', 'cafe')).toBe(false);
  });
});
