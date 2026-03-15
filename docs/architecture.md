# AIPassport Architecture

This document describes the system architecture of the AIPassport broker, its security boundaries, data flows, and trust model.

## System Overview

AIPassport is a mediating broker that sits between third-party applications (relying apps) and upstream AI providers. Its core job is to accept scoped, time-limited consent from a user and then proxy AI requests on behalf of the relying app -- injecting the user's real API key only at the last moment, server-side, without ever exposing it to the relying app.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AIPassport Broker                             │
│                                                                      │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐ │
│  │   Routes    │   │   Store    │   │ Middleware  │   │  Lib/Proxy │ │
│  │            │   │            │   │            │   │            │ │
│  │ grants.ts  │──▶│  SQLite    │   │ validate   │   │ proxy.ts   │ │
│  │ tokens.ts  │──▶│  DB for    │   │ (Zod)      │   │            │ │
│  │ proxy.ts   │──▶│  Grants,   │   │            │   │ Injects    │ │
│  │            │   │  Tokens,   │   │            │   │ real API   │ │
│  │            │   │  Requests  │   │            │   │ keys here  │ │
│  └────────────┘   └────────────┘   └────────────┘   └─────┬──────┘ │
│                                                            │        │
└────────────────────────────────────────────────────────────┼────────┘
                                                             │
           ┌─────────────────────────────────────────────────┤
           │                                                 │
           ▼                                                 ▼
  ┌─────────────────┐                              ┌─────────────────┐
  │  OpenAI API     │                              │  Anthropic API  │
  │  /v1/chat/...   │                              │  /v1/messages   │
  └─────────────────┘                              └─────────────────┘
```

## Components

### Routes Layer (`src/routes/`)

Three Express routers handle all incoming HTTP requests:

- **grants.ts** -- Grant lifecycle management. Handles creating grant requests, approving/denying pending grants, listing grants, and revoking active grants.
- **tokens.ts** -- Token issuance and inspection. Issues delegated tokens for approved grants and provides a token introspection endpoint.
- **proxy.ts** -- The AI proxy endpoint. Validates the bearer token, checks usage caps, and delegates to the upstream proxy.

### Store Layer (`src/store/index.ts`)

The store is the central authority for all state and business logic:

- **Storage**: SQLite tables (`grant_requests`, `grants`, `tokens`) store all state persistently in `data/aipassport.db`.
- **Grant lifecycle**: `addGrantRequest()`, `createGrantFromRequest()`, `revokeGrant()`, `getActiveGrants()`.
- **Token lifecycle**: `issueToken()`, `validateToken()`.
- **Usage accounting**: `incrementUsage()` tracks per-grant request counts and budget consumption.
- **Key resolution**: `getProviderKey()` reads raw API keys from environment variables. This is the only function in the system that touches raw credentials.

### Middleware Layer (`src/middleware/validate.ts`)

A generic Zod validation middleware factory. Wraps any Zod schema into Express middleware that validates `req.body` and returns structured 400 errors on failure.

### Proxy Layer (`src/lib/proxy.ts`)

The security-critical component. Given a validated `Grant` and a `ProxyRequest`:

1. Resolves the upstream API key via `getProviderKey()`.
2. Checks the requested model against the grant's model allowlist.
3. Checks the requested capability against the grant's capability list.
4. Dispatches the request to the appropriate provider endpoint with the real API key injected into the headers.

## Security Boundaries

The system has three distinct trust zones:

```
  UNTRUSTED                    TRUSTED                      EXTERNAL
  ─────────                    ───────                      ────────
  ┌───────────────┐      ┌──────────────────┐      ┌───────────────────┐
  │ Relying App   │      │ AIPassport       │      │ AI Provider       │
  │               │      │ Broker           │      │ (OpenAI, etc.)    │
  │ - Sends       │      │                  │      │                   │
  │   delegated   │─────▶│ - Validates      │─────▶│ - Receives real   │
  │   token       │      │   tokens         │      │   API key         │
  │ - Never sees  │◀─────│ - Enforces scope │◀─────│ - Returns         │
  │   real key    │      │ - Holds real     │      │   response        │
  │               │      │   API keys       │      │                   │
  └───────────────┘      └──────────────────┘      └───────────────────┘
```

### Boundary 1: Relying App to Broker

- The relying app authenticates with a **delegated token** (signed JWT).
- The relying app **never** receives, stores, or transmits the raw API key.
- Request bodies are validated against Zod schemas before processing.
- The broker checks token validity, grant status, expiration, and usage caps.

### Boundary 2: Broker to AI Provider

- The broker injects the raw API key into upstream requests inside `src/lib/proxy.ts`.
- The `getProviderKey()` function is the sole access point for raw credentials.
- Raw keys are read from environment variables, never from the store or from incoming requests.
- The broker enforces model allowlists and capability restrictions before forwarding.

### Boundary 3: User to Broker (Consent)

- In the MVP, consent is mediated through API calls (`/grants/:id/approve`).
- There is no user authentication in the MVP -- any caller can approve. This is a known limitation.

## Data Flow: Grant Request and Approval

```
  App                          Broker                        User
   │                             │                             │
   │  POST /grant-requests       │                             │
   │  { appName, appUrl,         │                             │
   │    scope, reason }          │                             │
   │ ───────────────────────────▶│                             │
   │                             │  Creates GrantRequest       │
   │                             │  Creates Grant (pending)    │
   │  ◀─ 201 { grantRequest,    │                             │
   │          grant }            │                             │
   │                             │                             │
   │                             │  User reviews grant in UI   │
   │                             │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
   │                             │                             │
   │                             │  POST /grants/:id/approve   │
   │                             │  { expiresInSeconds: 3600 } │
   │                             │◀────────────────────────────│
   │                             │                             │
   │                             │  Grant.status = "approved"  │
   │                             │  Grant.expiresAt = now+TTL  │
   │                             │                             │
   │                             │  ──▶ 200 { grant }          │
   │                             │                             │
```

## Data Flow: Token Issuance

```
  App                          Broker
   │                             │
   │  POST /tokens               │
   │  { grantId: "..." }         │
   │ ───────────────────────────▶│
   │                             │  Checks grant exists
   │                             │  Checks grant.status == "approved"
   │                             │  Checks grant not expired
   │                             │  Signs HS256 JWT (jose)
   │                             │  Stores DelegatedToken
   │  ◀─ 201 { token,           │
   │          grantId,           │
   │          issuedAt,          │
   │          expiresAt }        │
   │                             │
```

The response deliberately omits the `revoked` field and never includes any reference to the upstream API key.

## Data Flow: Proxied Request

```
  App                          Broker                       Provider
   │                             │                             │
   │  POST /proxy/chat           │                             │
   │  Authorization: Bearer <t>  │                             │
   │  { model, messages }        │                             │
   │ ───────────────────────────▶│                             │
   │                             │  validateToken(t)           │
   │                             │    ├─ JWT signature valid?  │
   │                             │    ├─ JWT not expired?      │
   │                             │    ├─ Token in DB?          │
   │                             │    ├─ Token not revoked?    │
   │                             │    ├─ Grant approved?       │
   │                             │    └─ Grant not expired?    │
   │                             │                             │
   │                             │  incrementUsage(grantId)    │
   │                             │    ├─ Within maxRequests?   │
   │                             │    └─ Within maxBudget?     │
   │                             │                             │
   │                             │  proxyToProvider(grant, req)│
   │                             │    ├─ Resolve API key       │
   │                             │    ├─ Check model allowlist │
   │                             │    ├─ Check capabilities    │
   │                             │    └─ POST to provider API  │
   │                             │ ───────────────────────────▶│
   │                             │                             │
   │                             │  ◀─ Provider response ─────│
   │  ◀─ 200 { response }       │                             │
   │                             │                             │
```

## Token Model

Delegated tokens are **HS256-signed JWTs** generated using the `jose` library. Each token embeds claims that allow cryptographic verification before any database lookup.

| Property | Value |
|----------|-------|
| Format | HS256-signed JWT (jose library) |
| Lifetime | Configurable via `TOKEN_TTL_SECONDS` (default: 3600s) |
| Binding | Each token is bound to exactly one grant via `grantId` (also embedded as `sub` claim) |
| Revocation | Tokens are revoked individually or cascade-revoked when their grant is revoked |
| Introspection | `GET /tokens/:token/inspect` returns validity and associated grant metadata |

### JWT Claims

| Claim | Description |
|-------|-------------|
| `sub` | Grant ID the token is bound to |
| `jti` | Unique token identifier |
| `iss` | Broker identifier (issuer) |
| `exp` | Expiration timestamp |

### Token Validation Checks (in order)

1. **JWT signature verification** -- verify HS256 signature using the server's signing key
2. **JWT expiration check** -- verify the `exp` claim has not passed
3. Token exists in the store (DB lookup by `jti`)
4. Token is not revoked
5. Associated grant exists
6. Associated grant status is `approved`
7. Associated grant has not expired

All seven checks must pass for a token to be considered valid.

## Store Design

The store uses SQLite (via `better-sqlite3`) with three tables in `data/aipassport.db`:

```sql
grant_requests   -- Keyed by request ID; stores app name, URL, scope, reason
grants           -- Keyed by grant ID; stores status, scope, expiration, usage counters, version
tokens           -- Keyed by jti; stores grantId, tokenType, issuer, issuedAt, expiresAt, revoked
```

The `data/` directory is auto-created on startup and `data/*.db` is gitignored. The store interface consists of pure functions -- swapping to Postgres for multi-instance deployments requires reimplementing these functions without changing the routes or proxy layers.

### Usage Accounting

The `Grant` object tracks two running counters:

- `usageCount` -- incremented on every proxied request
- `usageBudgetCents` -- intended for cost tracking (not yet wired to actual provider billing)

The `incrementUsage()` function checks these against the grant's `maxRequests` and `maxBudgetCents` caps. If either cap is exceeded, the proxy returns HTTP 429.

## Provider Proxy Design

The proxy layer (`src/lib/proxy.ts`) is provider-specific. Each supported provider has its own dispatch branch that:

1. Constructs the correct upstream URL
2. Sets the appropriate authentication headers (e.g., `Authorization: Bearer` for OpenAI, `x-api-key` for Anthropic)
3. Formats the request body according to the provider's API contract
4. Returns the raw JSON response from the provider

Currently supported providers:

| Provider | Status | Endpoint |
|----------|--------|----------|
| OpenAI | Fully implemented | `https://api.openai.com/v1/chat/completions` |
| Anthropic | Fully implemented | `https://api.anthropic.com/v1/messages` |
| Google | Mock response | Not yet connected to Gemini API |

## Trust Model

### Who trusts whom?

| Relationship | Trust Level | Notes |
|-------------|-------------|-------|
| User trusts Broker | **Full** | The broker holds the user's raw API keys and enforces consent decisions |
| Relying App trusts Broker | **Partial** | The app trusts the broker to proxy faithfully and return valid responses |
| Broker trusts User | **Full (MVP)** | No user authentication -- any caller can approve grants |
| Broker trusts Relying App | **None** | Every request is validated: token, scope, caps, model allowlist |
| Broker trusts Provider | **Full** | The broker sends the real API key and trusts the provider to honor it |
| User trusts Relying App | **Minimal** | The user grants only scoped, time-limited access; the app never sees the key |

### Key trust assumption

The entire security model depends on the broker being a trusted intermediary. If the broker is compromised, raw API keys are exposed. In a production deployment, the broker must be hardened accordingly (see Future Hardening Notes below).

## Future Hardening Notes

The MVP makes deliberate simplifications. A production-grade system would address:

### Cryptographic Tokens
HS256-signed JWTs are now implemented (v0.2) using the `jose` library, with embedded claims for grant ID, issuer, and expiration. Remaining hardening includes **key rotation** (scheduled re-signing with overlapping validity) and migration to **asymmetric keys** (RS256/ES256) to enable public-key verification without sharing the signing secret.

### Sender-Constrained Tokens
Bind tokens to the requesting client using **Demonstrating Proof-of-Possession (DPoP)** or mutual TLS (mTLS) certificate binding. This prevents token theft -- a stolen token is useless without the client's private key.

### User Authentication
Add real user authentication via **OAuth 2.0 / OpenID Connect**. The broker must verify that the person approving a grant is the actual owner of the API keys.

### Persistent Storage
SQLite persistence is implemented (v0.2). Remaining work:
- Multi-instance broker deployments (requires PostgreSQL)
- Audit trail queries
- Database migrations and schema versioning

### Audit Logging
Log every security-relevant event (grant creation, approval, denial, revocation, token issuance, proxy request, policy violation) to an append-only audit log.

### Rate Limiting
Enforce the `rateLimit` scope field with actual middleware (e.g., sliding window counters per grant). The field is defined in the schema but not enforced in the MVP.

### TLS Enforcement
Require HTTPS for all broker endpoints. Reject plaintext HTTP connections.

### Multi-Tenant Isolation
Support multiple users, each with their own API keys and grants, with proper isolation between tenants.
