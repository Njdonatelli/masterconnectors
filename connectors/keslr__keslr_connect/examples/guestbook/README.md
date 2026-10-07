# Keslr Guestbook

A guestbook. Every signature is a real human, so it has no moderation queue and doesn't need one.

It exists to show both packages working in one small app you can actually run.

## What it demonstrates

| Feature                          | Where                                    |
| -------------------------------- | ---------------------------------------- |
| Sign in with Keslr               | `keslrAuth()` in `src/server.ts`         |
| Verified-only writes             | `requireVerified()` on `POST /sign`      |
| Telling an unverified member why | `renderHome()` in `src/views.ts`         |
| Attributing the caller           | `keslrNetworkIdentity()` middleware      |
| Not binding `0.0.0.0`            | the `BIND_ADDRESS` check before `listen` |

## Run it

```bash
cp .env.example .env
# fill in KESLR_CLIENT_ID and SESSION_SECRET
npm install
npm run dev
```

Open http://localhost:8080.

You need a client ID from [developers.keslr.com](https://developers.keslr.com) with `http://localhost:8080/auth/keslr/callback` registered as a redirect URI.

The identity half is optional — without `KESLR_NETWORK_CLIENT_ID` the app skips attribution, so you can try the login flow from anywhere.

## What to copy, and what not to

**Copy:** the auth wiring, `requireVerified()`, keying rows on `keslrId` rather than username, the `escapeHtml` call on every interpolation in `views.ts`, and the refuse-to-start check on `BIND_ADDRESS`.

**Don't copy:** storage is an in-memory array in `src/db.ts` and resets on restart. The seam is deliberate — `initSchema`, `createEntry`, `listEntries` — so swapping in a database is a small change.

One detail worth stealing: entries key on `keslrId`, not username. Usernames change; the Keslr identifier doesn't. Key on something mutable and you inherit a migration the first time someone renames themselves.

## Deploy it

```bash
docker compose up -d
```

Set `BIND_ADDRESS` in `.env` to the host's Keslr address first. See [docs/hosting-on-keslr.md](../../docs/hosting-on-keslr.md).
