/**
 * Route guards.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describeVerificationStatus } from '@keslr/auth';

export interface GuardOptions {
  /**
   * Where to send an unauthenticated browser. When omitted, the guard responds
   * with JSON — the right default for an API, the wrong one for a page.
   */
  loginPath?: string;
  /** Append `?returnTo=<current path>` when redirecting. Default true. */
  preserveReturnTo?: boolean;
}

/**
 * Require a signed-in Keslr member.
 *
 * Says nothing about verification. Use {@link requireVerified} when the member
 * must be a verified human.
 */
export function requireAuth(options: GuardOptions = {}): RequestHandler {
  return function requireAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.keslr) {
      next();
      return;
    }

    if (options.loginPath) {
      res.redirect(buildLoginRedirect(req, options));
      return;
    }

    res.status(401).json({
      error: 'authentication_required',
      message: 'Sign in with Keslr to access this resource.',
    });
  };
}

/**
 * Require a signed-in member whose Keslr account is verified.
 *
 * This is the guard that expresses "only real, vouched-for humans past this
 * point". The 403 body includes the member's actual status and a plain-language
 * explanation, because "forbidden" with no reason is the most frustrating
 * possible response to someone who thought they had an account.
 */
export function requireVerified(options: GuardOptions = {}): RequestHandler {
  return function requireVerifiedMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!req.keslr) {
      if (options.loginPath) {
        res.redirect(buildLoginRedirect(req, options));
        return;
      }

      res.status(401).json({
        error: 'authentication_required',
        message: 'Sign in with Keslr to access this resource.',
      });
      return;
    }

    if (!req.keslr.user.isVerified) {
      res.status(403).json({
        error: 'verification_required',
        message: describeVerificationStatus(req.keslr.user.verificationStatus),
        verification_status: req.keslr.user.verificationStatus,
      });
      return;
    }

    next();
  };
}

function buildLoginRedirect(req: Request, options: GuardOptions): string {
  const loginPath = options.loginPath!;
  if (options.preserveReturnTo === false) return loginPath;

  const separator = loginPath.includes('?') ? '&' : '?';
  return `${loginPath}${separator}returnTo=${encodeURIComponent(req.originalUrl)}`;
}
