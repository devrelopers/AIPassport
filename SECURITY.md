# Security

AIPassport is an exploratory reference implementation. This document describes the current security model, its known limitations, and how to report security issues.

## Current Security Model

### What AIPassport protects

- **Raw API keys never leave the broker.** Provider credentials (OpenAI, Anthropic, etc.) are stored in server-side environment variables. They are injected into upstream requests only at proxy time, inside `src/lib/proxy.ts`. Third-party apps never receive, store, or transmit raw API keys.

- **Delegated tokens are signed JWTs.** Tokens are HS256-signed using the jose library. Each token embeds the grant ID (`sub`), a unique identifier (`jti`), the issuer (`iss`), and an expiration (`exp`). The broker verifies the signature and expiration cryptographically before checking the database for revocation status.

- **Access is scoped and time-limited.** Each grant specifies the provider, allowed models, capabilities, budget caps, and request limits. Grants expire automatically and can be revoked instantly.

- **Revocation is immediate.** Revoking a grant cascade-invalidates all associated tokens. Revoked tokens are rejected on the next validation attempt.

### What AIPassport does NOT protect (known limitations)

- **No user authentication.** The broker does not verify who is approving or revoking grants. In the current MVP, any HTTP client can call the approval endpoint. Do not expose the broker to untrusted networks without adding authentication.

- **No TLS enforcement.** The broker does not require HTTPS. Tokens and API responses are transmitted in cleartext unless you place the broker behind a TLS-terminating reverse proxy. In production, all traffic must be encrypted.

- **Single-server signing key.** JWT signing uses a symmetric HMAC key (HS256). If `JWT_SECRET` is not set, a random key is generated on startup and does not persist across restarts (tokens issued before a restart become invalid). For durable deployments, set `JWT_SECRET` explicitly. For multi-instance deployments, all instances must share the same key, or you must migrate to asymmetric keys (RS256/ES256).

- **No rate limiting enforcement.** The `rateLimit` scope field is defined in the schema but not enforced at the middleware level. A malicious app can send requests as fast as the server can process them, up to the `maxRequests` cap.

- **No audit logging.** Security-relevant events (grant approvals, token issuances, proxy requests, policy violations) are not logged to a persistent audit trail.

- **No sender-constrained tokens.** Tokens are bearer tokens -- anyone who possesses a valid token can use it. There is no proof-of-possession binding (DPoP, mTLS) to prevent token theft.

## Environment Variables and Secrets

| Variable | Contains | Handling |
|----------|----------|----------|
| `OPENAI_API_KEY` | Raw API key | Server-side only. Never included in API responses or logs. |
| `ANTHROPIC_API_KEY` | Raw API key | Server-side only. Never included in API responses or logs. |
| `GOOGLE_API_KEY` | Raw API key | Server-side only. Never included in API responses or logs. |
| `JWT_SECRET` | Token signing key | Server-side only. If compromised, all tokens can be forged. Rotate immediately if exposed. |

**Never commit `.env` files to version control.** The `.gitignore` excludes `.env` by default.

## Responsible Disclosure

If you discover a security vulnerability in AIPassport, please report it responsibly:

1. **Do not open a public GitHub issue** for security vulnerabilities.
2. Email the maintainers at **security@devrelopers.io** with a description of the vulnerability, steps to reproduce, and any relevant details.
3. Allow reasonable time for a fix before public disclosure.

We take security reports seriously and will respond as quickly as possible.

## Scope

This security document covers the AIPassport broker reference implementation. It does not cover:

- The security of upstream AI providers (OpenAI, Anthropic, etc.)
- The security of the hosting environment where the broker runs
- The security of applications that integrate with the broker

## Future Hardening

See the [roadmap](docs/roadmap.md) for planned security improvements, including:

- Asymmetric JWT signing keys (RS256/ES256) with rotation
- Sender-constrained tokens (DPoP / mTLS)
- Real user authentication (OAuth 2.0 / OIDC)
- Rate limiting infrastructure
- Audit logging
- TLS enforcement
