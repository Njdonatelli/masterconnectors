# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-07

Initial release.

### Added

**`@keslr/auth`**

- `KeslrAuthClient` — OIDC authorization code flow with PKCE
- ID token validation: RS256 signature, `iss`, `aud`, `azp`, `exp`, `iat`, `nbf`, `nonce`
- Discovery and JWKS caching, with rotation handling and refresh rate limiting
- `KeslrUser` normalisation and the `isVerified` helper
- `MemoryAuthorizationRequestStore` and the `AuthorizationRequestStore` interface
- Typed error hierarchy with stable `code` values
- Zero runtime dependencies

**`@keslr/express`**

- `keslrAuth()` router: login, callback, logout
- `requireAuth()` and `requireVerified()` guards
- `SessionAuthorizationRequestStore` with concurrent-login support
- Session ID rotation on login
- `returnTo` sanitisation against open redirects

**`@keslr/network`**

- `KeslrNetworkClient` — daemon status, `waitForOnline()`, `serve()`
- `IdentityLookup` — address to member, with caching, batching, and coalescing
- `keslrNetworkIdentity()` and `requireNetworkIdentity()` middleware

**Examples and docs**

- `examples/guestbook` — a small, complete app using both packages
- Quickstart, authentication, verification claims, hosting, and troubleshooting guides

[Unreleased]: https://github.com/keslr/keslr_connect/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/keslr/keslr_connect/releases/tag/v0.1.0
