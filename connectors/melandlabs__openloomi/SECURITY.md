# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.6.x   | :white_check_mark: |
| < 0.6   | :x:                |

## Reporting a Vulnerability

We take security issues seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please DO NOT file a public GitHub issue for security vulnerabilities.**

Instead, please report them via one of the following:

- **Email**: [security@alloomi.ai](mailto:developer@alloomi.ai)
- **GitHub Private Vulnerability Reporting** (available on the Security tab of this repository)

When reporting, please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested mitigations (if known)

### What to Expect

- We will acknowledge receipt of your report within **48 hours**
- We will provide an estimated timeline for a fix within **7 days**
- We will keep you updated on our progress
- Once the vulnerability is fixed, we will credit you in the release notes (unless you prefer to remain anonymous)

### Scope

Security issues in the following areas are in scope:

- Authentication and authorization mechanisms
- Data encryption and storage security
- API endpoints and integrations
- Local data storage and IndexedDB/SQLite security
- Desktop application security (Tauri/Rust backend)
- Third-party dependency vulnerabilities

### Out of Scope

- Social engineering attacks
- Physical security
- Denial of service attacks against public infrastructure
- Issues related to user's own server/infrastructure configuration

## Security Updates

Security updates will be released as patch versions (e.g., 0.6.1) and announced via:

- GitHub Security Advisories
- Release notes on GitHub Releases
- Discord announcements

## Security Best Practices for Users

When using OpenLoomi:

- Keep your installation updated to the latest version
- Review connector permissions before granting access
- Use strong authentication for integrated services (Gmail, Slack, etc.)
- Store your API keys securely and never share them
