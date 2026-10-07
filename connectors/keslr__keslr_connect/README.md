# keslr-connect

> **Status: pre-release.** The packages are not on npm yet — install from source (see [Installing](#installing)). The API may change before 1.0.

## What Keslr is

Keslr is an invite-only network whose members are verified humans.

You can't sign up. There's no registration form to fill in, no email loop to complete, no captcha to squint at. You get in because somebody already on the network vouches for you — they send you a referral, you accept it, and their verification propagates to your account. That chain of vouching is recorded as a trust graph, and it's the whole product.

If nobody you know is on Keslr, the Keslr team will vouch for you instead. They will also probably call you and make you say difficult words down the phone, or hop on video and ask you to pull a few faces, because it turns out that's still a decent way to tell a person from a program.

On top of that sits a private network. Members' devices get addresses in the `100.64.0.0/10` range, and services running on it — `nod.app.keslr.com` and friends — are reachable at those addresses and nowhere else. Not behind a login page on the public internet. Actually not on the public internet.

So Keslr gives an application two things it cannot get anywhere else:

1. **A user who is definitely a person**, attested by a chain of other people.
2. **A place to run** where the set of parties who can open a TCP connection to you is the set of verified humans.

The second one has a consequence worth stating plainly, because it changes how you'd design the app: **if your service is only reachable on the Keslr network, you may not need accounts at all.** A device only gets a Keslr address if the member behind it is verified, so anyone who can reach you is already a verified human — you just don't know _which_ one yet. One call to the lookup API turns their address into their identity. No signup form, no password, no session, no "verify your email".

Use the OIDC login when you need something a network address can't give you: an explicit consent step, a session that survives a change of device, or profile claims. Otherwise, look them up and get on with it.

This repository is the code for both.

## What this is

Three TypeScript packages and a working example.

| Package                              | What it does                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`@keslr/auth`](packages/auth)       | OpenID Connect relying party. Sign in with Keslr, and read the claim that says whether they're verified. Zero runtime dependencies. |
| [`@keslr/express`](packages/express) | Express routes and guards over `@keslr/auth`, for people who don't want to write the callback handler themselves.                   |
| [`@keslr/network`](packages/network) | Turns the Keslr address a request came from into the member who owns that device.                                                   |

Plus [`examples/guestbook`](examples/guestbook), which is a guestbook. Every signature is a real human. It has no moderation queue and it doesn't need one.

## Installing

Not published yet. For now:

```bash
git clone https://github.com/keslr/keslr_connect.git
cd keslr_connect
npm install
npm run build
```

Then reference the packages from your project with `npm link`, a workspace, or a `file:` dependency. Once they're on npm this becomes the usual thing:

```bash
npm install @keslr/auth @keslr/express   # not yet — see above
```

## Getting set up

Everything starts at [developers.keslr.com](https://developers.keslr.com):

1. **Sign in** with your Keslr account.
2. **Apply for developer access.** Applications are reviewed; you'll wait.
3. Once approved, **create an app**. Keslr allocates it an address on the network and a hostname of the form `your-app.app.keslr.com`, then asks you to verify DNS.
4. Register an **OIDC client** if you want the login flow, and a **network client** if you want address lookups. These are separate credentials — mixing them up is the most common first-day mistake.

## Signing someone in

With an OIDC client ID in hand:

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

That mounts `GET /auth/keslr/login`, `GET /auth/keslr/callback`, and `POST /auth/keslr/logout`, and puts the signed-in member on `req.keslr`.

Two things that will cost you an afternoon if you get them wrong, so they're worth stating plainly:

- **`sameSite: 'lax'`, not `'strict'`.** `'strict'` withholds the session cookie on the redirect _back_ from Keslr, so the callback arrives with no session and every login fails with `login_expired`. The symptom looks nothing like the cause.
- **The redirect URI must match byte for byte.** `http://localhost:3000/cb` and `http://localhost:3000/cb/` are different URIs. So are `localhost` and `127.0.0.1`.

Not using Express? `@keslr/express` is about a hundred lines of glue over `@keslr/auth`; use that directly. See [docs/authentication.md](docs/authentication.md).

## The claim that matters

```ts
req.keslr.user;
// {
//   id: '019f…',                        ← Keslr's UUID. Use this as your foreign key.
//   keslrId: 'KID-A1B2C3D4E5F6',
//   username: 'yourname',
//   verificationStatus: 'verified',
//   verificationMethod: 'referral_approved',
//   isVerified: true                     ← this one
// }
```

| Status                 | Meaning                                        |
| ---------------------- | ---------------------------------------------- |
| `verified`             | Vouched for through the trust graph. A person. |
| `pending_verification` | Verification underway, not yet decided         |
| `unverified`           | Registered, never verified                     |
| `rejected`             | Verification attempted and refused             |

**Read `isVerified`, not the string.** Writing `verification_status === 'verified'` by hand works right up until you typo it, and every way of typoing it fails _open_ — you let people in rather than keeping them out. It's computed once, in one place, and tested. Unknown statuses normalise to `unverified` for the same reason: if Keslr adds a status this release has never heard of, you deny access rather than accidentally granting it.

More in [docs/verification-claims.md](docs/verification-claims.md).

## Knowing who's calling — without a login

Requests arriving from the Keslr network come from addresses the network assigned to members, so you can resolve them:

```ts
import { IdentityLookup, keslrNetworkIdentity } from '@keslr/network';

const lookup = new IdentityLookup({
  baseUrl: 'https://api.keslr.com',
  clientId: process.env.KESLR_NETWORK_CLIENT_ID,
  clientSecret: process.env.KESLR_NETWORK_CLIENT_SECRET,
});

app.use(keslrNetworkIdentity({ lookup }));

app.get('/whoami', (req, res) => {
  res.json({ member: req.keslrNetwork?.username ?? null });
});
```

For a service reachable only on the Keslr network, that is often the entire user system. `req.keslrNetwork.userId` is the same UUID as the `sub` claim from `@keslr/auth`, so it works as a foreign key whether or not the member ever logs in — and you can add login later without migrating anything.

**But know what it proves.** It tells you whose _device_ opened the connection, not who is sitting at it. No session, no consent, no scopes, and a shared laptop speaks with its owner's name. That's fine for a forum, a dashboard, or a guestbook. For anything involving money, permissions, or private data, make them actually log in — the two compose:

```ts
app.post('/transfer', requireNetworkIdentity(), requireVerified(), handler);
```

And the thing that matters more than any of this code: **bind to your Keslr address, not `0.0.0.0`.** No middleware can make a publicly-reachable service private. If you listen on every interface, anyone who can route to your host connects, and the fact that they aren't a Keslr member won't stop them — it'll just make `req.keslrNetwork` null after they're already inside. [docs/hosting-on-keslr.md](docs/hosting-on-keslr.md) has the details, and a `ss -tlnp` you should run after every deploy.

## Design decisions you might disagree with

Some behaviour isn't configurable. Each of these prevents a specific attack, and making it an option would mostly be a way of letting people turn the protection off by accident:

- **PKCE is always on, S256 only.** `plain` isn't implemented; it protects against nothing an attacker who can see the authorization request can't defeat.
- **The `alg` header is never trusted.** RS256 is hard-coded. A token claiming `none` or `HS256` is rejected before any signature is computed. This is the family of bugs that has done more damage to JWT deployments than everything else combined.
- **Token exchanges are never retried.** Authorization codes are single-use, so a retry after a request that actually succeeded turns a network blip into a permanent `invalid_grant`.
- **`X-Forwarded-For` is ignored** unless you explicitly opt in. It's client-supplied.
- **State and nonce are compared in constant time.** String comparison short-circuits at the first differing byte, which is a timing oracle.

If you think one of these is wrong, open an issue with the threat model you have in mind — that's a conversation worth having. "Make it a flag" usually isn't, because a flag that fails open is a vulnerability with a config option in front of it.

## Docs

- [Quickstart](docs/quickstart.md) — nothing to signed-in member, about ten minutes
- [Authentication in depth](docs/authentication.md) — the flow, and what each check defends against
- [Verification claims](docs/verification-claims.md) — the statuses and how to use them
- [Hosting on Keslr](docs/hosting-on-keslr.md) — binding, addressing, deployment
- [Troubleshooting](docs/troubleshooting.md) — when it doesn't work

## Development

```bash
npm install
npm test          # 330 tests
npm run build
npm run lint
```

Tests use real RSA keys and real signatures — nothing is stubbed at the crypto layer, because a suite that mocks signature verification can't tell you whether signature verification works. The Express tests run a real server against a stub OIDC provider over real HTTP.

There's also `node scripts/smoke.mjs`, which checks that the live Keslr provider still looks the way the docs claim. It needs no credentials and runs in CI. It has already earned its keep: the docs had the wrong issuer URL, and it failed on the first run.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go to [SECURITY.md](SECURITY.md), not the public issue tracker.

## License

MIT © Keslr LLC
