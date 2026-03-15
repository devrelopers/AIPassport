---
title: Status & Limitations
layout: default
nav_order: 8
---

# Status & Limitations

AIPassport is an **exploratory reference implementation** demonstrating the concept of delegated AI access. It is not a production system, not a finalized standard, and not ready for deployment on untrusted networks.

**Current version:** v0.2.0

## What works

- Express/TypeScript broker server with a clean API
- SQLite persistent store — grants, tokens, and requests survive server restarts
- Signed JWT delegated tokens (HS256) with cryptographic verification
- Grant lifecycle: create, approve, deny, revoke, list
- Upstream proxy to OpenAI (chat completions) and Anthropic (messages)
- Model allowlist and capability enforcement per grant
- Usage counting with request cap enforcement
- Demo consent UI and dashboard
- 57 passing tests (unit + HTTP integration)

## Known limitations

These are intentional simplifications in the current implementation. Each is documented in [SECURITY.md](https://github.com/devrelopers/AIPassport/blob/main/SECURITY.md) and tracked in the [Roadmap](roadmap).

### No user authentication

The broker does not verify who is approving or revoking grants. Any HTTP client that can reach the broker can approve a grant request. **Do not expose the broker to untrusted networks.**

This is the most critical limitation. Real user authentication (OAuth 2.0 / OIDC) is planned for Phase 2.

### Single-server signing key

JWT signing uses a symmetric HMAC key (HS256). If `JWT_SECRET` is not set, a random key is generated on startup and tokens do not survive restarts. For multi-instance deployments, all instances must share the same key — or you must migrate to asymmetric keys (RS256/ES256).

Key rotation is not yet implemented.

### No TLS enforcement

The broker does not require HTTPS. Tokens and API responses travel in cleartext unless you place the broker behind a TLS-terminating reverse proxy.

### No rate limiting enforcement

The `rateLimit` scope field is defined in the grant schema but not enforced at the middleware level. A malicious app can send requests as fast as the server processes them, up to the `maxRequests` cap.

### No audit logging

Security-relevant events (grant approvals, token issuances, proxy requests, policy violations) are not logged to a persistent audit trail.

### No sender-constrained tokens

Tokens are bearer tokens — anyone who possesses a valid token can use it. There is no proof-of-possession binding (DPoP, mTLS) to prevent token theft.

### Budget tracking is not connected to real costs

The `maxBudgetCents` and `usageBudgetCents` fields exist but are not wired to actual provider billing data. Budget enforcement is based on the counter, not real cost.

### Google provider is mocked

The Google provider proxy returns mock responses. Only OpenAI and Anthropic proxies make real upstream API calls.

## What this project is not

- **Not a production system.** Do not deploy this to serve real users without addressing the limitations above.
- **Not a finalized standard.** The API surface, grant format, and token model may change.
- **Not a replacement for OAuth.** AIPassport is complementary to OAuth — user authentication should use standard OAuth/OIDC.
- **Not an AI provider.** The broker proxies requests; it does not host models or provide inference.

## Responsible disclosure

If you discover a security vulnerability, please email **security@devrelopers.io** rather than opening a public issue. See [Security Model](security) for details.
