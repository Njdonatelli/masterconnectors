/**
 * `@keslr/express` — drop-in "Sign in with Keslr" for Express applications.
 *
 * This package is a thin, opinionated wrapper over `@keslr/auth`. It mounts
 * three routes and gives you two guards. If your framework is not Express, or
 * you want control over the routes, use `@keslr/auth` directly — everything here
 * is a hundred lines of glue over it.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import session from 'express-session';
 * import { keslrAuth, requireVerified } from '@keslr/express';
 *
 * const app = express();
 * app.use(session({ secret: process.env.SESSION_SECRET!, resave: false, saveUninitialized: false }));
 *
 * app.use(keslrAuth({
 *   issuer: 'https://api.keslr.com',
 *   clientId: process.env.KESLR_CLIENT_ID!,
 *   clientSecret: process.env.KESLR_CLIENT_SECRET,
 *   redirectUri: 'https://example.com/auth/keslr/callback',
 * }));
 *
 * app.get('/members-only', requireVerified(), (req, res) => {
 *   res.send(`Hello ${req.keslr!.user.username}`);
 * });
 * ```
 *
 * @packageDocumentation
 */

export { keslrAuth } from './router.js';
export type { KeslrAuthMiddlewareOptions } from './router.js';

export { requireAuth, requireVerified } from './guards.js';
export type { GuardOptions } from './guards.js';

export { SessionAuthorizationRequestStore } from './session.js';
export type { KeslrSession, SessionLike } from './session.js';

export type { KeslrRequestContext } from './types.js';
