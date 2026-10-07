import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertValidCodeVerifier,
  CODE_CHALLENGE_METHOD,
  createPkcePair,
  deriveCodeChallenge,
  generateCodeVerifier,
  verifyCodeChallenge,
} from '../src/pkce.js';

describe('generateCodeVerifier', () => {
  it('produces a verifier within the RFC 7636 length bounds', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('uses only unreserved characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it('never repeats across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(1000);
  });
});

describe('deriveCodeChallenge', () => {
  // The canonical vector from RFC 7636 Appendix B.
  it('matches the RFC 7636 Appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is the base64url of the SHA-256 of the verifier', () => {
    const verifier = generateCodeVerifier();
    const expected = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });

  it('is deterministic', () => {
    const verifier = generateCodeVerifier();
    expect(deriveCodeChallenge(verifier)).toBe(deriveCodeChallenge(verifier));
  });

  it('rejects a verifier that is too short', () => {
    expect(() => deriveCodeChallenge('tooshort')).toThrow(TypeError);
  });

  it('rejects a verifier containing reserved characters', () => {
    const invalid = `${'a'.repeat(42)}+`;
    expect(() => deriveCodeChallenge(invalid)).toThrow(/unreserved characters/);
  });
});

describe('createPkcePair', () => {
  it('returns a matched pair using S256', () => {
    const pair = createPkcePair();
    expect(pair.codeChallengeMethod).toBe(CODE_CHALLENGE_METHOD);
    expect(pair.codeChallenge).toBe(deriveCodeChallenge(pair.codeVerifier));
  });

  it('never emits the "plain" method', () => {
    // `plain` offers no protection against an attacker who observes the
    // authorization request, so it is deliberately unimplemented.
    for (let i = 0; i < 20; i++) {
      expect(createPkcePair().codeChallengeMethod).toBe('S256');
    }
  });
});

describe('assertValidCodeVerifier', () => {
  it('accepts a 43-character verifier', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(43))).not.toThrow();
  });

  it('accepts a 128-character verifier', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(128))).not.toThrow();
  });

  it('rejects 42 characters', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(42))).toThrow(/at least 43/);
  });

  it('rejects 129 characters', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(129))).toThrow(/at most 128/);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])('rejects the non-string %s', (value) => {
    expect(() => assertValidCodeVerifier(value)).toThrow(/must be a string/);
  });
});

describe('verifyCodeChallenge', () => {
  it('accepts a matching pair', () => {
    const pair = createPkcePair();
    expect(verifyCodeChallenge(pair.codeVerifier, pair.codeChallenge)).toBe(true);
  });

  it('rejects a mismatched pair', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(verifyCodeChallenge(a.codeVerifier, b.codeChallenge)).toBe(false);
  });

  it('returns false rather than throwing on an invalid verifier', () => {
    expect(verifyCodeChallenge('too-short', 'anything')).toBe(false);
  });
});
