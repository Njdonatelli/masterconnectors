# Authentication in depth

What `@keslr/auth` does, and why each step is there.

## The flow

```
  Browser              Your server                   api.keslr.com
     │                      │                              │
     │  GET /login          │                              │
     ├─────────────────────►│                              │
     │                      │ generate state, nonce, PKCE  │
     │                      │ store server-side by state   │
     │  302 → authorize     │                              │
     │◄─────────────────────┤                              │
     │                                                     │
     │  GET /api/oidc/authorize?...&code_challenge=...          │
     ├────────────────────────────────────────────────────►│
     │                          member signs in            │
     │  302 → /callback?code=...&state=...                  │
     │◄────────────────────────────────────────────────────┤
     │                      │                              │
     │  GET /callback       │                              │
     ├─────────────────────►│                              │
     │                      │ 1. verify state  ← CSRF      │
     │                      │ 2. POST /oidc/token          │
     │                      ├─────────────────────────────►│
     │                      │◄─────────────────────────────┤
     │                      │ 3. verify signature via JWKS │
     │                      │ 4. verify iss/aud/exp/nonce  │
     │                      │ 5. GET /oidc/userinfo        │
     │                      │ 6. rotate session ID         │
     │  302 → /             │                              │
     │◄─────────────────────┤                              │
```

Order matters at step 1: `state` is checked **before** the code is redeemed. A forged callback then costs a string comparison rather than a token-endpoint round trip and a consumed authorization code.

## What each guard defends

| Mechanism        | Attack it prevents                                                              |
| ---------------- | ------------------------------------------------------------------------------- |
| `state`          | CSRF — an attacker's code silently logging a victim into the attacker's account |
| `nonce`          | Replay of a previously captured ID token into a fresh login                     |
| PKCE             | Redemption of a stolen authorization code                                       |
| Signature        | Wholesale token fabrication                                                     |
| `iss`            | Another provider's token accepted as Keslr's                                    |
| `aud` / `azp`    | A token minted for a different application replayed at yours                    |
| `exp`            | Indefinite reuse after logout or revocation                                     |
| Session rotation | Session fixation                                                                |

Remove any one and there is a specific, named way in.

### On the `alg` header

The most damaging JWT vulnerabilities all come from libraries that trusted `alg`:

- `alg: "none"` — strip the signature, library accepts it.
- `alg: "HS256"` on an RS256 provider — sign with the RSA _public_ key as an HMAC secret; a library that picks its algorithm from the header verifies it successfully.

`@keslr/auth` never consults the header to choose an algorithm. RS256 is hard-coded; a token declaring anything else is rejected before any signature work. This is not configurable, and the tests in `tokens.test.ts` assert it directly.

## Storing pending requests

Between the redirect and the callback you must persist `state`, `nonce`, and `codeVerifier`. Two rules:

1. **Server-side only.** The `codeVerifier` is a secret. A cookie-backed store must _encrypt_, not merely sign.
2. **Single use.** `take()` must read and delete atomically, or an authorization code can be replayed at your callback.

```ts
// Development / single process
import { MemoryAuthorizationRequestStore } from '@keslr/auth';
const store = new MemoryAuthorizationRequestStore();

// Production — @keslr/express does this for you
import { SessionAuthorizationRequestStore } from '@keslr/express';
const store = new SessionAuthorizationRequestStore(req.session);
```

`MemoryAuthorizationRequestStore` does not work behind a load balancer: a login that starts on one instance and returns to another finds nothing. Use a shared session store.

### Concurrent logins

A member can legitimately have several logins in flight — two tabs, or one they abandoned. Pending requests are therefore keyed by `state`, not stored in a single slot. Storing only the most recent breaks the older tab, which users experience as "login randomly fails" and which is miserable to diagnose.

## Error handling

Match on `code`, never on messages:

```ts
import { isKeslrAuthError } from '@keslr/auth';

try {
  const { user } = await keslr.exchangeCode(params);
} catch (error) {
  if (isKeslrAuthError(error, 'state_mismatch')) return res.redirect('/login?e=expired');
  if (isKeslrAuthError(error, 'id_token_expired')) return res.redirect('/login?e=expired');
  if (isKeslrAuthError(error, 'provider_error')) return res.redirect('/login?e=denied');
  throw error;
}
```

| Code                         | Usual cause                                  | Response                            |
| ---------------------------- | -------------------------------------------- | ----------------------------------- |
| `state_mismatch`             | Expired login, replayed callback, or forgery | Send them back to `/login`          |
| `nonce_mismatch`             | Token replay                                 | Treat as an attack; log it          |
| `id_token_expired`           | Clock skew, or a very slow login             | Retry once, then investigate clocks |
| `id_token_signature_invalid` | Wrong issuer, or forgery                     | Never retry                         |
| `provider_error`             | Member cancelled, or client misconfigured    | Read `error.oauthError`             |
| `discovery_invalid`          | Wrong issuer URL                             | Fix configuration                   |
| `not_verified`               | Member is real but unverified                | Explain, don't just deny            |

## Sessions

`@keslr/express` stores the member in the session and rotates the session ID on login. Rolling your own:

```ts
const { user, idToken } = await keslr.exchangeCode(params);

await new Promise((resolve, reject) =>
  req.session.regenerate((err) => (err ? reject(err) : resolve(undefined))),
);

req.session.user = user;
req.session.idToken = idToken; // only if you need id_token_hint at logout
```

Do not store the access token on the request object or anywhere it will be serialised into logs. Keep it in the session and fetch it explicitly when you need to call a Keslr API on the member's behalf.

## Public clients

Browser and mobile apps cannot hold a secret — shipping one does not make the client confidential, it makes the secret public.

```ts
const keslr = new KeslrAuthClient({
  issuer: 'https://api.keslr.com',
  clientId: 'your-spa-client-id',
  // no clientSecret
  redirectUri: 'https://app.example/callback',
});
```

PKCE is what protects a public client, and it is always on. Register the client as `spa` or `mobile` at developers.keslr.com so Keslr enforces PKCE server-side too.

## Logout

```ts
const url = await keslr.createLogoutUrl({
  idTokenHint: session.idToken,
  postLogoutRedirectUri: 'https://app.example/',
});
res.redirect(url ?? '/');
```

Returns `null` when the provider advertises no `end_session_endpoint`, in which case clearing your own session is all you can do — the member stays signed in to Keslr itself, and the next login will be silent.
