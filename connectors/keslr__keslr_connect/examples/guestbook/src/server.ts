/**
 * Keslr Guestbook — a small, complete app using both halves of `keslr-connect`.
 *
 * A guestbook is about the smallest thing worth building on a network of
 * verified humans: there is no moderation queue because a bot cannot obtain a
 * Keslr invitation to sign it with.
 *
 * It demonstrates:
 *
 * 1. `@keslr/express` — "Sign in with Keslr", with a guard that admits only
 *    verified members.
 * 2. `@keslr/network` — attributing each request to the Keslr member whose
 *    device opened it, and binding to a Keslr address rather than `0.0.0.0`.
 *
 * Run it with `npm run dev`. See README.md for configuration.
 */

import express from 'express';
import session from 'express-session';
import { keslrAuth, requireVerified } from '@keslr/express';
import { IdentityLookup, keslrNetworkIdentity } from '@keslr/network';
import { createEntry, listEntries, initSchema } from './db.js';
import { renderHome, renderError } from './views.js';

const PORT = Number(process.env.PORT ?? 8080);
const KESLR_ISSUER = process.env.KESLR_ISSUER ?? 'https://api.keslr.com';
const KESLR_API_BASE = process.env.KESLR_API_BASE ?? 'https://api.keslr.com';
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Copy .env.example to .env and fill it in with the credentials from https://developers.keslr.com.`,
    );
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const clientId = requireEnv('KESLR_CLIENT_ID');
  const sessionSecret = requireEnv('SESSION_SECRET');

  initSchema();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax', // 'lax' still permits the OIDC redirect back to us
        secure: PUBLIC_URL.startsWith('https://'),
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // ---- Part 1: Sign in with Keslr -----------------------------------------

  app.use(
    keslrAuth({
      issuer: KESLR_ISSUER,
      clientId,
      clientSecret: process.env.KESLR_CLIENT_SECRET,
      redirectUri: `${PUBLIC_URL}/auth/keslr/callback`,
      successRedirect: '/',
      onLogin: (_req, { user }) => {
        console.log(`${user.username} signed in (${user.verificationStatus})`);
      },
    }),
  );

  // ---- Part 2: Network identity -------------------------------------------
  //
  // Optional: only wired up when network credentials are present, so the example
  // still runs when you are not calling it from the Keslr network.

  if (process.env.KESLR_NETWORK_CLIENT_ID && process.env.KESLR_NETWORK_CLIENT_SECRET) {
    const lookup = new IdentityLookup({
      baseUrl: KESLR_API_BASE,
      clientId: process.env.KESLR_NETWORK_CLIENT_ID,
      clientSecret: process.env.KESLR_NETWORK_CLIENT_SECRET,
    });

    app.use(
      keslrNetworkIdentity({
        lookup,
        // Non-strict: attribute when we can, never block on the lookup being up.
        strict: false,
        onLookupError: (error) => console.warn('Network identity lookup failed:', error),
      }),
    );
  }

  // ---- Routes --------------------------------------------------------------

  app.get('/', (req, res) => {
    res.type('html').send(
      renderHome({
        entries: listEntries(50),
        user: req.keslr?.user,
        networkIdentity: (req as never as { keslrNetwork?: { username: string } }).keslrNetwork,
      }),
    );
  });

  // Only verified members may sign.
  app.post('/sign', requireVerified(), (req, res) => {
    const message = String(req.body.message ?? '').trim();

    if (message.length === 0 || message.length > 280) {
      res
        .status(400)
        .type('html')
        .send(renderError('Your message must be between 1 and 280 characters.'));
      return;
    }

    createEntry({
      keslrId: req.keslr!.user.keslrId ?? req.keslr!.user.id,
      username: req.keslr!.user.username ?? 'anonymous',
      fullName: req.keslr!.user.fullName,
      message,
    });

    res.redirect('/');
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ---- Listen --------------------------------------------------------------
  //
  // Bind to the host's Keslr address, not 0.0.0.0. A service on the Keslr
  // network is reachable by members because it listens on an address only the
  // network routes to; binding every interface makes it reachable by anyone who
  // can route to the host, which quietly undoes that no matter what the
  // middleware says.
  //
  // Set BIND_ADDRESS to your host's Keslr address in production. It defaults to
  // localhost so the example runs anywhere.

  const bindAddress = process.env.BIND_ADDRESS ?? '127.0.0.1';

  if (bindAddress === '0.0.0.0' || bindAddress === '::') {
    console.error(
      'Refusing to start: BIND_ADDRESS is every interface, which would expose a members-only service publicly.',
    );
    process.exit(1);
  }

  app.listen(PORT, bindAddress, () => {
    console.log(`Guestbook listening on http://${bindAddress}:${PORT}`);
    console.log(`Sign in at ${PUBLIC_URL}/auth/keslr/login`);
  });
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
