# Troubleshooting

## Authentication

### `redirect_uri_mismatch` / `invalid_request` at the authorize step

The URI must match a registered one **exactly**. These are all different:

```
http://localhost:3000/callback
http://localhost:3000/callback/     ← trailing slash
http://127.0.0.1:3000/callback      ← different host
https://localhost:3000/callback     ← different scheme
```

Print what you're actually sending:

```ts
console.log(new URL(request.url).searchParams.get('redirect_uri'));
```

### Every login fails with `login_expired`

Almost always the session cookie is not surviving the redirect back from Keslr.

- `sameSite: 'strict'` blocks it. Use `'lax'`.
- `secure: true` over plain HTTP silently drops it. Tie it to `NODE_ENV`.
- Behind a proxy, `app.set('trust proxy', 1)` so `req.protocol` is right.
- Multiple instances with in-memory sessions: the callback landed on a different instance. Use a shared store.

### `discovery_invalid`: issuer mismatch

Your `issuer` doesn't match what the discovery document declares. Check for a typo, a trailing slash, or a staging URL left in configuration.

```bash
curl -s https://api.keslr.com/.well-known/openid-configuration | jq .issuer
```

### `id_token_claims_invalid`: issuer mismatch

Same cause, different layer — and note this comparison is **exact**, including trailing slash, because the spec requires it.

### `id_token_expired` immediately after login

Clock skew. Check with `timedatectl status`, and fix it with NTP rather than by raising `clockToleranceSeconds` — the tolerance exists for milliseconds of drift, not minutes of it. The package refuses tolerances above 300 seconds for this reason.

### `id_token_signature_invalid`

In order of likelihood: wrong issuer (a staging token against production JWKS); a proxy rewriting the response body; or an actual forgery. Never retry — a token that fails signature validation carries no trustworthy information at all.

### `jwks_key_not_found`

Keslr rotated its signing key and your cache is stale. The package refetches once on a miss, rate limited to one refresh per 30 seconds. If it persists, the token was signed by something that is not Keslr.

### `state_mismatch` on every callback

Your store isn't persisting. Check that `put` runs before the redirect, that `take` uses the `state` from the query string, and — if sessions back the store — that the session survives the round trip.

## Network

### `EADDRNOTAVAIL` when the service starts

The address in `BIND_ADDRESS` is not configured on this host. Check what Keslr address the host actually holds:

```bash
ip -4 addr show | grep '100\.'
```

If nothing comes back, the host is not on the Keslr network yet.

### Members get "connection refused"

You bound to `127.0.0.1`. Bind the host's Keslr address instead, and confirm with:

```bash
ss -tlnp | grep <your-port>
```

### Non-members can reach your service

You bound to `0.0.0.0`. This is the important one — see [hosting-on-keslr.md](hosting-on-keslr.md#binding-the-part-people-get-wrong).

### `req.keslrNetwork` is always null

- The caller isn't on the Keslr network.
- You're behind a proxy and `trustProxy` is off — but read the warning before enabling it.
- The device joined more recently than the lookup cache TTL.

### `lookup_unauthorized`

The network client credentials are wrong, or the client isn't authorized for address lookups. These are **separate credentials** from your OIDC client ID and secret — a common mix-up.

### Lookups are slow

Every uncached lookup is a round trip to `api.keslr.com`. Raise `cacheTtlMs`, and prefer `resolveMany()` when you need several addresses — it batches into one request.

## Debugging

```ts
import { createConsoleLogger } from '@keslr/auth';

const keslr = new KeslrAuthClient({
  // ...
  logger: createConsoleLogger('debug'),
});
```

The logger redacts tokens, codes, and secrets by key name. Even so, don't leave `debug` on in production.

To inspect a token without trusting it:

```ts
import { decodeJwt } from '@keslr/auth';
const { header, claims } = decodeJwt(idToken);
console.log(header.kid, claims.iss, claims.aud, new Date(claims.exp * 1000));
```

**Those claims are attacker-controlled until verification has run.** Print them; never branch on them.

## Still stuck?

Open an issue at [github.com/keslr/keslr_connect](https://github.com/keslr/keslr_connect/issues) with the error `code`, the package version, your Node version, and a redacted config. Please don't paste tokens — anyone reading the issue can decode them.
