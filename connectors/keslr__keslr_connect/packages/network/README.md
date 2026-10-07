# @keslr/network

Resolve an inbound request to the [Keslr](https://keslr.com) member who owns the calling device.

Services on the Keslr network receive connections from addresses the network assigned to members. This package turns those addresses into identities.

```bash
npm install @keslr/network   # not published yet — see the repo root README
```

## Use

```ts
import { IdentityLookup, keslrNetworkIdentity, requireNetworkIdentity } from '@keslr/network';

const lookup = new IdentityLookup({
  baseUrl: 'https://api.keslr.com',
  clientId: process.env.KESLR_NETWORK_CLIENT_ID,
  clientSecret: process.env.KESLR_NETWORK_CLIENT_SECRET,
  cacheTtlMs: 60_000,
});

app.use(keslrNetworkIdentity({ lookup }));

app.get('/whoami', (req, res) => {
  res.json({ member: req.keslrNetwork?.username ?? null });
});

app.post('/members-only', requireNetworkIdentity(), handler);
```

## Attribution, not authentication

It tells you whose _device_ opened the connection — not who is sitting at it. No session, no consent, no scopes, and a shared laptop speaks with its owner's name.

Fine for logs, personalisation, and rate limiting. For anything involving money, permissions, or private data, require a login with [`@keslr/auth`](../auth) as well. They compose:

```ts
app.post('/transfer', requireNetworkIdentity(), requireVerified(), handler);
```

## Bind to your Keslr address

This package cannot make a publicly-reachable service private. If your process binds `0.0.0.0`, anyone who can route to the host connects, and `req.keslrNetwork` is simply `null` for them — after they are already inside your application.

```ts
app.listen(8080, process.env.BIND_ADDRESS); // the host's Keslr address
```

See [docs/hosting-on-keslr.md](../../docs/hosting-on-keslr.md).

## API

| Export                     | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `IdentityLookup`           | Address → member, with caching, batching, and request coalescing |
| `keslrNetworkIdentity()`   | Middleware attaching `req.keslrNetwork`                          |
| `requireNetworkIdentity()` | Guard rejecting callers with no resolved identity                |
| `isKeslrNetworkError()`    | Typed error matching                                             |

### Caching

Both hits and misses are cached. Caching misses matters: without it, anything hitting your service repeatedly from outside the network turns into one API call per request, which amplifies exactly the traffic you least want to amplify.

`resolveMany()` batches, chunks to the API ceiling, and skips addresses already cached.

### Proxies

`X-Forwarded-For` is ignored unless you pass `trustProxy: true`. It is client-supplied: if anything but your own proxy can reach the service, an attacker sets it to a member's address and inherits their identity.

## Credentials

The lookup API uses OAuth client credentials, which are **separate** from your OIDC client ID and secret. Mixing them up produces `lookup_unauthorized`.

## License

MIT © Keslr LLC
