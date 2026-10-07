# @keslr/express

Express middleware for "Sign in with Keslr". A thin wrapper over [`@keslr/auth`](../auth).

```bash
npm install @keslr/express express-session
```

## Use

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
    cookie: { httpOnly: true, sameSite: 'lax', secure: true },
  }),
);

app.use(
  keslrAuth({
    issuer: 'https://api.keslr.com',
    clientId: process.env.KESLR_CLIENT_ID!,
    clientSecret: process.env.KESLR_CLIENT_SECRET,
    redirectUri: 'https://example.com/auth/keslr/callback',
  }),
);

app.get('/profile', requireAuth(), (req, res) => res.json(req.keslr!.user));
app.post('/posts', requireVerified(), createPost);
```

> `sameSite: 'lax'`, not `'strict'` — `'strict'` blocks the session cookie on the redirect back from Keslr, and every login fails with `login_expired`.

## Routes

| Route                     | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `GET {basePath}/login`    | Start a login. Accepts `?returnTo=/path` |
| `GET {basePath}/callback` | Complete a login                         |
| `POST {basePath}/logout`  | Clear the session, end the Keslr session |

`basePath` defaults to `/auth/keslr`.

## Guards

| Guard               | Requires                                     |
| ------------------- | -------------------------------------------- |
| `requireAuth()`     | A signed-in member, verified or not          |
| `requireVerified()` | A signed-in member whose account is verified |

Both respond with JSON by default. Pass `loginPath` to redirect browsers instead:

```ts
app.get('/dashboard', requireVerified({ loginPath: '/auth/keslr/login' }), handler);
```

A signed-in but unverified member is never redirected to login — that would be an infinite loop. They get a 403 explaining their actual status.

## Options

| Option            | Default       | Notes                                        |
| ----------------- | ------------- | -------------------------------------------- |
| `basePath`        | `/auth/keslr` | Route prefix                                 |
| `successRedirect` | `/`           | Where to land after login                    |
| `requireVerified` | `false`       | Refuse login entirely for unverified members |
| `onLogin`         | —             | Provision a local user record                |
| `onError`         | —             | Override error handling                      |

Plus everything `KeslrAuthClient` accepts.

## What it does for you

- Rotates the session ID on login (session fixation)
- Sanitises `returnTo` to same-origin paths (open redirects)
- Supports concurrent logins across browser tabs
- Serialises pending requests so they survive a JSON session store

## License

MIT © Keslr LLC
