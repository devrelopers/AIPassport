---
title: Home
layout: default
nav_order: 1
---

# AIPassport

**OAuth-inspired delegated AI access — stop sharing raw API keys with every app that wants to use AI on your behalf.**

AIPassport is an exploratory reference implementation of a broker that sits between third-party applications and upstream AI providers. Instead of handing apps your raw API key, you grant them scoped, time-limited, revocable access through signed JWT tokens. The broker enforces permissions, proxies requests, and injects real credentials only at the point of the upstream call.

Raw provider keys never leave the server.

{: .warning }
> **This is a reference implementation and a starting point for discussion — not a finished standard or production system.** See [Status & Limitations](status) and [Security Model](security) for details.

---

## How it works

1. A third-party app **requests access** to a specific AI provider, model, and capability
2. The user **reviews and approves** the request through a consent flow, setting scope and time limits
3. The broker **issues a signed JWT** — a short-lived delegated token that never contains the raw API key
4. The app **sends requests through the broker** using the token as a Bearer credential
5. The broker **validates the token**, checks scopes and usage caps, injects the real API key, and proxies the request upstream
6. The user can **revoke access** at any time — all associated tokens are instantly invalidated

---

## Key properties

- **Raw API keys stay server-side.** Provider credentials are stored in environment variables and injected only at proxy time.
- **Delegated tokens are signed JWTs.** Tokens carry embedded claims (grant ID, issuer, expiration) and are cryptographically verified on every request.
- **Access is scoped.** Each grant specifies the provider, allowed models, capabilities, request caps, and budget limits.
- **Access is time-limited.** Grants and tokens expire automatically.
- **Access is revocable.** Revoking a grant cascade-invalidates all its tokens immediately.

---

## Current implementation

The reference implementation is built with Express, TypeScript, SQLite, and the jose JWT library. It includes a demo UI, upstream proxy support for OpenAI and Anthropic, and a test suite with 57 passing tests.

See [Getting Started](getting-started) to run it locally, or [Architecture](architecture) for the system design.

---

## Links

- [GitHub Repository](https://github.com/devrelopers/AIPassport)
- [Devrelopers on GitHub](https://github.com/devrelopers)
- [v0.2.0 Release](https://github.com/devrelopers/AIPassport/releases/tag/v0.2.0)
- [Changelog](https://github.com/devrelopers/AIPassport/blob/main/CHANGELOG.md)
