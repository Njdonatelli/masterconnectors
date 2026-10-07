# Quickstart

From nothing to a signed-in verified member in about ten minutes.

## 1. Get developer access

Go to [developers.keslr.com](https://developers.keslr.com), sign in with your Keslr account, and apply. Applications are reviewed, so this is not instant.

Once you're approved you can create apps. Each app is allocated an address on the Keslr network and a hostname like `your-app.app.keslr.com`, and you verify DNS from the dashboard.

## 2. Add an OIDC client

Within your app, add an OIDC client. You will be asked for:

- **Redirect URI** — where Keslr sends members after they authenticate, e.g. `http://localhost:3000/auth/keslr/callback`. Register your development URI too; you can add several.
- **Application type** — `web` for a server-rendered app or API (issues a client secret), `spa` or `mobile` for a public client (no secret, PKCE only).

You'll receive a **client ID**, and for confidential clients a **client secret**.

> **The redirect URI must match byte for byte.** `http://localhost:3000/callback` and `http://localhost:3000/callback/` are different URIs, and so are `localhost` and `127.0.0.1`. This is the most common first-time failure by a wide margin.

## 3. Install

```bash
npm install @keslr/auth @keslr/express express-session
```

## 4. Configure

```bash
# .env
KESLR_ISSUER=https://api.keslr.com
KESLR_CLIENT_ID=your-client-id
KESLR_CLIENT_SECRET=your-client-secret   # omit for public clients
SESSION_SECRET=generate-a-long-random-string
PUBLIC_URL=http://localhost:3000
```

Generate a session secret with `openssl rand -base64 48`. Never commit it.

## 5. Wire it up

```ts
import express from 'express';
import session from 'express-session';
import { keslrAuth, requireAuth, requireVerified } from '@keslr/express';

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  }),
);

app.use(
  keslrAuth({
    issuer: process.env.KESLR_ISSUER!,
    clientId: process.env.KESLR_CLIENT_ID!,
    clientSecret: process.env.KESLR_CLIENT_SECRET,
    redirectUri: `${process.env.PUBLIC_URL}/auth/keslr/callback`,
  }),
);

app.get('/', (req, res) => {
  if (!req.keslr) return res.send('<a href="/auth/keslr/login">Sign in with Keslr</a>');
  const { user } = req.keslr;
  res.send(`Hello ${user.username}. Verified: ${user.isVerified}`);
});

app.get('/members-only', requireVerified(), (req, res) => {
  res.send('Only verified humans see this.');
});

app.listen(3000);
```

> `sameSite: 'lax'` matters. `'strict'` blocks the cookie on the redirect _back_ from Keslr, so the callback arrives with no session and the login fails with `login_expired` — a confusing symptom for an easy mistake.

## 6. Try it

```bash
npm run dev
open http://localhost:3000
```

Sign in. You should land back on `/` with your username and `Verified: true`.

## What you now have

```ts
req.keslr?.user;
// {
//   id: '019f...',                        ← your foreign key
//   keslrId: 'KID-A1B2C3D4E5F6',
//   username: 'yourname',
//   email: 'you@example.com',
//   verificationStatus: 'verified',
//   verificationMethod: 'referral_approved',
//   isVerified: true                       ← the claim that matters
// }
```

## Next

- [Authentication in depth](authentication.md) — the flow, session handling, error cases
- [Verification claims](verification-claims.md) — what each status means and how to use it
- [Hosting on Keslr](hosting-on-keslr.md) — the network half
- [Troubleshooting](troubleshooting.md) — when it doesn't work
