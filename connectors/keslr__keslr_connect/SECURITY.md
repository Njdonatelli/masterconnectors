# Security policy

## Reporting a vulnerability

Email **security@keslr.com**. Please do not open a public issue.

Include: a description, reproduction steps, affected versions, and impact as you see it. A proof of concept helps.

We aim to acknowledge within 2 business days and to ship a fix or a mitigation plan within 14 days for anything rated high or critical. We'll credit you in the advisory unless you'd rather we didn't.

## Scope

**In scope** — anything in `packages/`:

- Token validation bypasses
- PKCE, state, or nonce handling flaws
- Session fixation or session handling flaws
- Cache poisoning in discovery or JWKS
- Timing attacks on secret comparison
- Open redirects via `returnTo`

**Out of scope:**

- The Keslr provider itself (report to security@keslr.com separately)
- `examples/` — illustrative, not production code
- Dependency vulnerabilities with no exploitable path through this code
- Anything requiring an already-compromised host

## Design decisions

These are deliberate and not vulnerabilities, though we'd like to hear if you think one is wrong:

| Decision                               | Rationale                                                     |
| -------------------------------------- | ------------------------------------------------------------- |
| RS256 hard-coded                       | Prevents `alg: none` and RS256/HS256 confusion                |
| PKCE not disableable                   | Public clients have no other protection                       |
| Token exchange never retried           | Codes are single-use; a retry breaks a valid login            |
| JWKS refresh rate limited              | Otherwise unknown `kid` values amplify into outbound requests |
| Unknown status → `unverified`          | Fails closed                                                  |
| `X-Forwarded-For` ignored by default   | It's client-supplied                                          |
| Length leaked by constant-time compare | All compared values are fixed-length                          |

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✓         |

Pre-1.0, only the latest minor receives security fixes.
