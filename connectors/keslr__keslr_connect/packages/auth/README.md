# @keslr/auth

OpenID Connect relying party for [Keslr](https://keslr.com). Framework-agnostic, **zero runtime dependencies**.

```bash
npm install @keslr/auth
```

## Use

```ts
import { KeslrAuthClient, toPendingRequest, assertVerified } from '@keslr/auth';

const keslr = new KeslrAuthClient({
  issuer: 'https://api.keslr.com',
  clientId: process.env.KESLR_CLIENT_ID!,
  clientSecret: process.env.KESLR_CLIENT_SECRET, // omit for public clients
  redirectUri: 'https://example.com/auth/keslr/callback',
});

// Start
const request = await keslr.createAuthorizationUrl();
await store.put(toPendingRequest(request));
redirect(request.url);

// Finish
const pending = await store.take(query.state);
const { user, accessToken } = await keslr.exchangeCode({
  params: query,
  expectedState: pending.state,
  expectedNonce: pending.nonce,
  codeVerifier: pending.codeVerifier,
});

assertVerified(user); // throws NotVerifiedError unless verified
```

Using Express? [`@keslr/express`](../express) does the above for you.

## API

| Export                            | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `KeslrAuthClient`                 | The client                             |
| `MemoryAuthorizationRequestStore` | Pending-request store for development  |
| `AuthorizationRequestStore`       | Interface to implement for production  |
| `assertVerified` / `isVerified`   | Verification checks                    |
| `describeVerificationStatus`      | Human-readable explanation of a status |
| `decodeJwt` / `verifyIdToken`     | Low-level token handling               |
| `createPkcePair`                  | PKCE generation                        |
| `isKeslrAuthError`                | Typed error matching                   |

Full reference: [docs/authentication.md](../../docs/authentication.md).

## Security

- PKCE always, `S256` only. Not configurable.
- The `alg` header is never trusted — RS256 is hard-coded.
- Constant-time comparison for `state` and `nonce`.
- Token exchanges are never retried (codes are single-use).
- JWKS refresh-on-miss is rate limited to 30 seconds.
- Unknown verification statuses normalise to `unverified`.

See [SECURITY.md](../../SECURITY.md).

## License

MIT © Keslr LLC
