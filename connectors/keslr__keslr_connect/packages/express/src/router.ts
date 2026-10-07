/**
 * The Express router that implements the login, callback, and logout routes.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  KeslrAuthClient,
  isKeslrAuthError,
  toPendingRequest,
  type KeslrAuthClientOptions,
} from '@keslr/auth';
import {
  destroySession,
  regenerateSession,
  SessionAuthorizationRequestStore,
  type SessionLike,
} from './session.js';

export interface KeslrAuthMiddlewareOptions extends KeslrAuthClientOptions {
  /** Path prefix for the mounted routes. Default `/auth/keslr`. */
  basePath?: string;
  /** Where to send members after a successful login. Default `/`. */
  successRedirect?: string;
  /** Where to send members after logout. Default `/`. */
  logoutRedirect?: string;
  /**
   * Require `verification_status === 'verified'` to complete a login.
   *
   * Default false: unverified members are signed in, and route guards decide
   * what they may do. Set true only if an unverified member has literally
   * nothing to do in your application — otherwise they hit an opaque login
   * failure with no way to understand why.
   */
  requireVerified?: boolean;
  /**
   * Called after a successful login, before the redirect. Use it to provision a
   * local user record.
   */
  onLogin?: (
    req: Request,
    context: { user: import('@keslr/auth').KeslrUser },
  ) => void | Promise<void>;
  /** Called when a login fails. Default: pass the error to Express. */
  onError?: (error: unknown, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Mount the Keslr authentication routes.
 *
 * Mounts, relative to `basePath`:
 *
 * - `GET  /login`    — begin a login. Accepts `?returnTo=` for a post-login path.
 * - `GET  /callback` — complete a login.
 * - `POST /logout`   — clear the session and, where supported, end the Keslr session.
 *
 * Also attaches `req.keslr` on every request when a member is signed in, so it
 * should be mounted before your routes.
 */
export function keslrAuth(options: KeslrAuthMiddlewareOptions): Router {
  const {
    basePath = '/auth/keslr',
    successRedirect = '/',
    logoutRedirect = '/',
    requireVerified = false,
    onLogin,
    onError,
    ...clientOptions
  } = options;

  const client = new KeslrAuthClient(clientOptions);
  const router = Router();

  // Rehydrate req.keslr from the session on every request.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const session = getSession(req);
    const stored = session?.keslr;

    if (stored?.user && stored.authenticatedAt) {
      req.keslr = {
        user: stored.user,
        authenticatedAt: new Date(stored.authenticatedAt),
      };
    }

    next();
  });

  router.get(`${basePath}/login`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = requireSession(req);
      const store = new SessionAuthorizationRequestStore(session);

      const request = await client.createAuthorizationUrl({
        prompt: req.query.prompt as never,
        loginHint: typeof req.query.login_hint === 'string' ? req.query.login_hint : undefined,
      });

      store.put(toPendingRequest(request, sanitizeReturnTo(req.query.returnTo)));

      res.redirect(request.url);
    } catch (error) {
      handleError(error, req, res, next, onError);
    }
  });

  router.get(`${basePath}/callback`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = requireSession(req);
      const store = new SessionAuthorizationRequestStore(session);

      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const pending = store.take(state);

      if (!pending) {
        // Either the login expired, the callback was replayed, or someone
        // forged it. All three are indistinguishable here, and all three should
        // simply send the member back to try again.
        res.status(400).json({
          error: 'login_expired',
          message: 'This login has expired or was already used. Please try signing in again.',
        });
        return;
      }

      const result = await client.exchangeCode({
        params: req.query as never,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
      });

      if (requireVerified && !result.user.isVerified) {
        res.status(403).json({
          error: 'not_verified',
          message:
            'Your Keslr account is not verified yet. Keslr membership is granted by invitation from an existing verified member.',
          verification_status: result.user.verificationStatus,
        });
        return;
      }

      // Rotate the session ID before storing the identity — see session.ts.
      // Note the reassignment: express-session hands back a *new* session
      // object, and writing to the old reference would be discarded.
      const rotated = await regenerateSession(req as unknown as { session?: SessionLike });

      rotated.keslr = {
        ...rotated.keslr,
        user: result.user,
        authenticatedAt: new Date().toISOString(),
        idToken: result.idToken,
        pending: {},
      };

      req.keslr = { user: result.user, authenticatedAt: new Date() };

      await onLogin?.(req, { user: result.user });

      res.redirect(pending.returnTo ?? successRedirect);
    } catch (error) {
      handleError(error, req, res, next, onError);
    }
  });

  router.post(`${basePath}/logout`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = getSession(req);
      const idToken = session?.keslr?.idToken;

      if (session) await destroySession(session);
      delete req.keslr;

      const providerLogout = await client.createLogoutUrl({
        idTokenHint: idToken,
        postLogoutRedirectUri: absoluteUrl(req, logoutRedirect),
      });

      res.redirect(providerLogout ?? logoutRedirect);
    } catch (error) {
      handleError(error, req, res, next, onError);
    }
  });

  return router;
}

function getSession(req: Request): SessionLike | undefined {
  return (req as unknown as { session?: SessionLike }).session;
}

function requireSession(req: Request): SessionLike {
  const session = getSession(req);
  if (!session) {
    throw new Error(
      '@keslr/express requires session middleware. Mount express-session (or an equivalent) before keslrAuth().',
    );
  }
  return session;
}

/**
 * Reduce `returnTo` to a safe, same-origin path.
 *
 * An unvalidated redirect target is an open redirect: an attacker sends a member
 * a link to your own login endpoint with `?returnTo=https://evil.example`, the
 * member logs in to a domain they trust, and lands somewhere they don't. Only
 * absolute paths on this origin are allowed, and protocol-relative URLs
 * (`//evil.example`) are rejected explicitly because they look like paths.
 */
export function sanitizeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (!value.startsWith('/')) return undefined;
  if (value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  return value;
}

function absoluteUrl(req: Request, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}${path}` : path;
}

function handleError(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
  onError?: KeslrAuthMiddlewareOptions['onError'],
): void {
  if (onError) {
    onError(error, req, res, next);
    return;
  }

  // Turn the errors a member can legitimately cause into readable responses,
  // and let everything else hit the application's error handler.
  if (isKeslrAuthError(error, 'state_mismatch') || isKeslrAuthError(error, 'provider_error')) {
    res.status(400).json({
      error: (error as { code: string }).code,
      message: 'Sign-in could not be completed. Please try again.',
    });
    return;
  }

  next(error);
}
