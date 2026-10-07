# Hosting a service on Keslr

How to run a service that Keslr members can reach and nobody else can.

Signing in with an identity provider is a solved problem. Running a service that is invisible to the public internet but trivially reachable by a vouched-for community is less so, and mostly comes down to one decision about which address you bind.

---

## The model

A Keslr service is not "a public service with a login page". It is a service with **no public attack surface at all**.

```
                    ┌─────────────────────────────┐
   public internet  │   nothing listening here    │
                    └─────────────────────────────┘

                    ┌─────────────────────────────┐
   Keslr network    │  nod.app.keslr.com          │  ← members only
                    │  100.64.0.7:8080         │
                    └─────────────────────────────┘
```

Your host is on the Keslr network and holds a Keslr address in the `100.64.0.0/10` range. Your process binds _that_ address. A DNS record points a friendly name at it — that's how `nod.app.keslr.com` works.

The address only routes inside the network. There is no port to scan, no certificate to enumerate in a transparency log, no bot traffic, no credential stuffing. The set of parties who can open a TCP connection to your service is exactly the set of verified Keslr members.

That property is worth more than any amount of application-layer defence, and it is also the easiest thing to accidentally destroy. See [Binding](#binding-the-part-people-get-wrong).

---

## Prerequisites

Both come from [developers.keslr.com](https://developers.keslr.com) once your developer application is approved:

1. **An allocated Keslr address for your app.** Creating an app assigns one; it's shown in the dashboard.
2. **A hostname**, allocated at the same time as `your-app.app.keslr.com`, pointing at that address. Verify it from the dashboard once DNS has propagated.

Confirm the address is configured on the host that will run the service:

```bash
ip -4 addr show | grep '100\.'
```

---

## Step 1: bind to the Keslr address

```ts
const BIND_ADDRESS = process.env.BIND_ADDRESS; // e.g. 100.64.0.7

app.listen(8080, BIND_ADDRESS, () => {
  console.log(`Listening on ${BIND_ADDRESS}:8080`);
});
```

Put the address in configuration rather than hard-coding it — it is assigned to the host, so it changes if the service moves.

## Step 2: refuse to start if that goes wrong

Worth the five lines. A deployment mistake that swaps your bind address for `0.0.0.0` publishes a members-only service to the internet silently, and nothing will alert you.

```ts
if (!BIND_ADDRESS || BIND_ADDRESS === '0.0.0.0' || BIND_ADDRESS === '::') {
  throw new Error('Refusing to start: a members-only service must bind a Keslr address');
}
```

---

## Binding: the part people get wrong

```ts
app.listen(8080); // ✗ binds 0.0.0.0 — every interface
app.listen(8080, '0.0.0.0'); // ✗ same thing, explicitly
app.listen(8080, '100.64.0.7'); // ✓ the Keslr address only
```

If your process binds every interface, anyone who can route to your host can connect. On a cloud VM with a public IP, that is the entire internet. The identity middleware will attach `null` for those connections — but by then they have already reached your application, and can hit unauthenticated routes, consume resources, and probe for bugs.

**Middleware is a second line of defence. Binding is the first.** After deploying, confirm it:

```bash
ss -tlnp | grep 8080
# LISTEN 0 511 100.64.0.7:8080   ✓
# LISTEN 0 511 0.0.0.0:8080         ✗ fix this
```

---

## Step 3: know who is calling

```ts
import { IdentityLookup, keslrNetworkIdentity, requireNetworkIdentity } from '@keslr/network';

const lookup = new IdentityLookup({
  baseUrl: 'https://api.keslr.com',
  clientId: process.env.KESLR_NETWORK_CLIENT_ID,
  clientSecret: process.env.KESLR_NETWORK_CLIENT_SECRET,
  cacheTtlMs: 60_000,
});

app.use(keslrNetworkIdentity({ lookup }));

app.get('/feed', (req, res) => {
  const member = req.keslrNetwork; // NetworkIdentity | null
  res.json({ greeting: member ? `Hello ${member.username}` : 'Hello stranger' });
});

app.post('/admin/purge', requireNetworkIdentity(), handler);
```

The lookup resolves a Keslr address to the member who owns that device, over HTTPS against `api.keslr.com`. Results are cached, and batch lookups are coalesced into a single call.

### What this proves, precisely

| It does prove                                               | It does not prove                    |
| ----------------------------------------------------------- | ------------------------------------ |
| The connection came from a device registered to that member | That the member is at the keyboard   |
| The network vouches for the mapping                         | That they consented to use your app  |
| Attribution good enough for logs and rate limits            | Authorization for anything sensitive |

A shared laptop, a screen-sharing session, or a compromised machine all speak with the owner's identity. **For anything that moves money, changes permissions, or reveals private data, require an OIDC login as well** — see [authentication.md](authentication.md). The two compose:

```ts
app.post(
  '/transfer',
  requireNetworkIdentity(), // must be on the network
  requireVerified(), // and must have actually signed in
  handler,
);
```

### Strict mode

```ts
app.use(keslrNetworkIdentity({ lookup, strict: true }));
```

Rejects requests whose address has no Keslr member, and fails _closed_ if the lookup API is unavailable. Correct for a service that must never serve a non-member — but note the coupling you are accepting: a Keslr API outage becomes your outage. Non-strict mode fails open, attaching `null` and letting your handlers decide.

### Proxies

`X-Forwarded-For` is **ignored by default**. It is client-supplied data: if anything other than your own proxy can reach the service, an attacker sets the header to a member's address and inherits their identity.

```ts
app.use(keslrNetworkIdentity({ lookup, trustProxy: true })); // only behind a proxy you control
```

Only enable this when a proxy you operate _overwrites_ the header on every inbound request.

---

## Deployment

### Docker

```yaml
services:
  myservice:
    build: .
    env_file: .env # BIND_ADDRESS=100.64.0.7
    network_mode: host # so the process can bind the host's Keslr address
    restart: unless-stopped
```

`network_mode: host` is the simple path — the container sees the host's addresses directly. Without it you would need to publish the port and map it, which reintroduces the chance of exposing it publicly.

### systemd

```ini
[Unit]
Description=My Keslr service
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/myservice/dist/server.js
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/etc/myservice/env
User=myservice

[Install]
WantedBy=multi-user.target
```

`After=network-online.target` matters. Binding a specific address fails outright if that address is not configured yet, so a service that starts too early crashes on boot and looks like an application bug.

---

## Health checks

```ts
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', boundTo: BIND_ADDRESS });
});
```

Including the bound address turns your health endpoint into a check on the property that actually matters. If it ever reports `0.0.0.0`, you have a public service and an incident.

---

## Troubleshooting

| Symptom                        | Cause                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| `EADDRNOTAVAIL` on startup     | Host is not on the Keslr network, or the address changed                |
| Members get connection refused | Bound to `127.0.0.1` instead of the Keslr address                       |
| Non-members can reach it       | Bound to `0.0.0.0` — see [Binding](#binding-the-part-people-get-wrong)  |
| `lookup_unauthorized`          | Network client credentials wrong, or not authorized for lookups         |
| `req.keslrNetwork` always null | Behind a proxy without `trustProxy`, or the caller isn't on the network |

See [troubleshooting.md](troubleshooting.md) for more.
