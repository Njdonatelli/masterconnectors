import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireAuth, requireVerified } from '../src/guards.js';
import type { KeslrUser, VerificationStatus } from '@keslr/auth';

function user(status: VerificationStatus = 'verified'): KeslrUser {
  return {
    id: 'user-uuid',
    keslrId: 'KID-ABCDEFGHIJKL',
    email: 'member@keslr.test',
    emailVerified: true,
    fullName: 'Test Member',
    username: 'testmember',
    verificationStatus: status,
    verificationMethod: 'referral_approved',
    isVerified: status === 'verified',
    raw: {} as never,
  };
}

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return { originalUrl: '/members-only', ...overrides } as Request;
}

function fakeResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    redirectedTo: undefined as string | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    redirect(url: string) {
      res.redirectedTo = url;
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

describe('requireAuth', () => {
  it('calls next for a signed-in member', () => {
    const next = vi.fn();
    const req = fakeRequest({ keslr: { user: user(), authenticatedAt: new Date() } } as never);

    requireAuth()(req, fakeResponse(), next);

    expect(next).toHaveBeenCalled();
  });

  it('responds 401 JSON when no loginPath is configured', () => {
    const res = fakeResponse();
    const next = vi.fn();

    requireAuth()(fakeRequest(), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'authentication_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects to loginPath when configured', () => {
    const res = fakeResponse();

    requireAuth({ loginPath: '/auth/keslr/login' })(fakeRequest(), res, vi.fn());

    expect(res.redirectedTo).toBe('/auth/keslr/login?returnTo=%2Fmembers-only');
  });

  it('omits returnTo when asked', () => {
    const res = fakeResponse();

    requireAuth({ loginPath: '/auth/keslr/login', preserveReturnTo: false })(
      fakeRequest(),
      res,
      vi.fn(),
    );

    expect(res.redirectedTo).toBe('/auth/keslr/login');
  });

  it('uses & when loginPath already has a query string', () => {
    const res = fakeResponse();

    requireAuth({ loginPath: '/login?mode=keslr' })(fakeRequest(), res, vi.fn());

    expect(res.redirectedTo).toBe('/login?mode=keslr&returnTo=%2Fmembers-only');
  });

  // requireAuth is about being signed in, not about being verified.
  it('admits an unverified member', () => {
    const next = vi.fn();
    const req = fakeRequest({
      keslr: { user: user('unverified'), authenticatedAt: new Date() },
    } as never);

    requireAuth()(req, fakeResponse(), next);

    expect(next).toHaveBeenCalled();
  });
});

describe('requireVerified', () => {
  it('calls next for a verified member', () => {
    const next = vi.fn();
    const req = fakeRequest({ keslr: { user: user(), authenticatedAt: new Date() } } as never);

    requireVerified()(req, fakeResponse(), next);

    expect(next).toHaveBeenCalled();
  });

  it('responds 401 when nobody is signed in', () => {
    const res = fakeResponse();

    requireVerified()(fakeRequest(), res, vi.fn());

    expect(res.statusCode).toBe(401);
  });

  it.each(['unverified', 'pending_verification', 'rejected'] as const)(
    'responds 403 for status %s',
    (status) => {
      const res = fakeResponse();
      const req = fakeRequest({
        keslr: { user: user(status), authenticatedAt: new Date() },
      } as never);

      requireVerified()(req, res, vi.fn());

      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({
        error: 'verification_required',
        verification_status: status,
      });
    },
  );

  // A bare "forbidden" gives a member no way to understand or fix the problem.
  it('explains why in plain language', () => {
    const res = fakeResponse();
    const req = fakeRequest({
      keslr: { user: user('unverified'), authenticatedAt: new Date() },
    } as never);

    requireVerified()(req, res, vi.fn());

    const message = (res.body as { message: string }).message;
    expect(message).toMatch(/invitation/i);
    expect(message.length).toBeGreaterThan(20);
  });

  it('redirects an unauthenticated browser when loginPath is set', () => {
    const res = fakeResponse();

    requireVerified({ loginPath: '/auth/keslr/login' })(fakeRequest(), res, vi.fn());

    expect(res.redirectedTo).toContain('/auth/keslr/login');
  });

  // A signed-in but unverified member must get an explanation, not a login loop.
  it('does not redirect a signed-in unverified member to login', () => {
    const res = fakeResponse();
    const req = fakeRequest({
      keslr: { user: user('unverified'), authenticatedAt: new Date() },
    } as never);

    requireVerified({ loginPath: '/auth/keslr/login' })(req, res, vi.fn());

    expect(res.redirectedTo).toBeUndefined();
    expect(res.statusCode).toBe(403);
  });
});
