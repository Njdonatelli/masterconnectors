# Security Policy

## Supported versions

Security fixes are provided for the latest minor release on `main`. Older releases are not patched.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email security reports to **security@gridex.app** (or the maintainer's GitHub-listed contact) with:

- A description of the issue
- Steps to reproduce
- The affected version
- (Optional) Proof-of-concept code

You can expect:

- Acknowledgement within **72 hours**
- An initial assessment within **7 days**
- A patch released as soon as feasible based on severity

Responsible disclosure is appreciated — please allow time for a fix before public disclosure. Credit will be given in release notes unless you prefer anonymity.

## Scope

In scope:
- The Gridex macOS app (`macos/`)
- The Gridex Windows app (`windows/`)
- Build and release scripts (`scripts/`)
- The landing site (`landing/`)

Out of scope:
- Third-party dependencies — report upstream (Swift NIO, PostgresNIO, etc.)
- Self-compiled forks with modifications
- Issues in versions older than the latest release

## Credential handling

Gridex stores database and SSH passwords in the macOS Keychain using `kSecClassGenericPassword`. Credentials never leave the user's machine except via the SSH tunnel or database connection the user explicitly configures. AI provider API keys are stored the same way.

If you believe credentials are being logged, transmitted, or stored insecurely, please report via the channel above.
