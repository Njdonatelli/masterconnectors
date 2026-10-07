# Contributing

Thanks for considering it.

## Getting started

```bash
git clone https://github.com/keslr/keslr_connect.git
cd keslr_connect
npm install
npm test
npm run build
```

Requires Node 20.10 or later.

## Layout

```
packages/auth/      OIDC relying party. No runtime dependencies — keep it that way.
packages/express/   Express glue over @keslr/auth.
packages/network/   Network reachability and member attribution.
examples/guestbook/ A complete app using both halves.
docs/               Prose documentation.
```

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm run format
npm test
```

CI runs all of these on Node 20 and 22, plus a coverage threshold.

## What we're looking for

**Yes please:**

- Bug fixes, with a test that fails before the fix
- Adapters for other frameworks (Fastify, Hono, Koa, Next.js)
- Documentation improvements, especially error messages that confused you
- Better error messages

**Please discuss first:**

- New runtime dependencies in `@keslr/auth` — it has none, deliberately
- Anything that changes the security posture (see below)
- Public API changes

## Security-relevant changes

Some behaviour is not configurable on purpose. Before proposing a change to any of it, please open an issue explaining the threat model you have in mind:

- PKCE is always on, S256 only. `plain` will not be implemented.
- The `alg` header is never trusted; RS256 is hard-coded.
- Token exchanges are never retried.
- Unknown verification statuses normalise to `unverified`, not `verified`.
- `X-Forwarded-For` is ignored unless explicitly trusted.

Each of these prevents a specific, documented attack. We're happy to be shown a better mechanism, but "make it an option" usually isn't one — an option that fails open is a vulnerability with a config flag in front of it.

## Tests

Tests are the specification, particularly in `packages/auth/test/tokens.test.ts`. That suite is written so that deleting any single validation in `tokens.ts` turns at least one test red. If you change validation logic, keep that property.

Don't mock the crypto layer. Test helpers in `test/helpers/keys.ts` generate real RSA keys and real signatures — a suite that stubs signature verification cannot tell you whether signature verification works.

## Style

Prettier and ESLint are authoritative; run `npm run format`.

For comments, explain **why**, not what. `// increment i` is noise. `// Codes are single-use, so a retry turns a blip into a hard failure` is worth its line.

## Reporting bugs

Include the error `code`, package version, Node version, and a minimal reproduction. Redact tokens — anyone reading the issue can decode them.

## Security vulnerabilities

Do not open a public issue. See [SECURITY.md](SECURITY.md).
