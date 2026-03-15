---
title: Roadmap
layout: default
nav_order: 7
---

# AIPassport Roadmap

This document outlines the phased development plan for AIPassport, from the current MVP to a production-grade delegated AI access system.

---

## Phase 1: MVP

**Goal**: Prove the core concept of delegated AI access through a working reference implementation.

**Status**: Complete (v0.2).

### Delivered

- [x] Express/TypeScript broker server
- [x] SQLite persistent store for grants, tokens, and requests
- [x] Zod-validated API for grant requests, approval, denial, and revocation
- [x] Signed JWT delegated token issuance (HS256) and validation
- [x] JWT token verification with signature and expiration checks
- [x] Upstream proxy to OpenAI (chat completions)
- [x] Upstream proxy to Anthropic (messages)
- [x] Mock proxy for Google provider
- [x] Model allowlist enforcement per grant
- [x] Capability restriction enforcement per grant
- [x] Usage counting with request cap enforcement
- [x] Budget cap field defined (not yet wired to real cost data)
- [x] Rate limit field defined (not yet enforced at middleware level)
- [x] Token introspection endpoint
- [x] Grant revocation with cascading token invalidation
- [x] Demo consent UI and dashboard
- [x] Health check endpoint

### Known Limitations

- No user authentication -- any caller can approve grants
- JWT signing uses a single server-local key (no rotation or multi-instance support)
- No TLS enforcement
- No audit logging
- Rate limiting is defined in schema but not enforced
- Budget tracking is not connected to actual provider billing

---

## Phase 2: Persistence and Authentication

**Goal**: Make the broker durable and introduce real user identity.

### Persistent Storage

- [ ] Abstract the store behind an interface (`StoreAdapter`) to enable pluggable backends
- [x] Implement SQLite adapter for single-server deployments
- [ ] Implement PostgreSQL adapter for multi-instance deployments
- [ ] Add database migrations and schema versioning
- [x] Ensure all state survives server restarts

### User Authentication

- [ ] Integrate OAuth 2.0 / OpenID Connect for user login
- [ ] Bind API keys to authenticated user accounts
- [ ] Require authenticated sessions for grant approval, denial, and revocation
- [ ] Add session management (cookies or bearer tokens for the user, distinct from delegated tokens)

### App Registration

- [ ] Allow apps to pre-register with the broker (name, URL, redirect URIs)
- [ ] Assign client IDs to registered apps
- [ ] Validate grant requests against registered app metadata

### Consent UI

- [ ] Build a proper consent screen (not just API calls) showing:
  - Requesting app name and URL
  - Requested provider, models, and capabilities
  - Requested budget and time limits
  - Plain-language reason for the request
- [ ] Build a user dashboard showing active grants, usage, and revocation controls

---

## Phase 3: Security Hardening

**Goal**: Make delegated tokens cryptographically robust and resistant to theft and replay.

### Signed JWT Tokens

- [x] Replace opaque UUIDs with signed JWTs (Done -- HS256)
- [x] Embed claims: grant ID, scopes, issuer, audience, issued-at, expiration
- [ ] Enable stateless token validation for distributed deployments
- [ ] Implement key rotation for signing keys

### Sender-Constrained Tokens

- [ ] Implement DPoP (Demonstrating Proof-of-Possession) per RFC 9449
- [ ] Bind tokens to the client's ephemeral key pair
- [ ] Reject proxied requests that cannot prove possession of the binding key
- [ ] Alternatively, support mTLS client certificate binding (RFC 8705)

### Token Binding to Client TLS Certificate

- [ ] Issue tokens bound to the client's TLS certificate thumbprint
- [ ] Validate the certificate thumbprint on every proxied request
- [ ] Prevent token use from a different TLS session

### Rate Limiting Infrastructure

- [ ] Enforce the `rateLimit` scope field with sliding-window counters
- [ ] Per-grant and per-app rate limiting
- [ ] Return `Retry-After` headers on HTTP 429 responses
- [ ] Consider token-bucket or leaky-bucket algorithms

### TLS Enforcement

- [ ] Require HTTPS for all endpoints
- [ ] Reject plaintext HTTP connections
- [ ] Add HSTS headers

### Input Hardening

- [ ] Add request size limits
- [ ] Add prompt injection detection heuristics (defense in depth)
- [ ] Sanitize and validate all proxy request fields beyond Zod schema checks

---

## Phase 4: Provider Ecosystem

**Goal**: Support a wide range of AI providers with deep integration.

### Provider-Specific Adapters

- [ ] Define a `ProviderAdapter` interface for pluggable provider support
- [ ] Implement adapters for:
  - OpenAI (chat, embeddings, images, audio)
  - Anthropic (messages, streaming)
  - Google Gemini
  - Mistral
  - Cohere
  - Local/self-hosted models (Ollama, vLLM)
- [ ] Support provider-specific request/response normalization

### Model Capability Discovery

- [ ] Query provider APIs for available models and their capabilities
- [ ] Expose a `/providers` or `/models` endpoint for apps to discover what is available
- [ ] Auto-populate scope suggestions based on discovered capabilities

### Budget Metering with Actual Cost Tracking

- [ ] Parse provider response headers and metadata for token usage
- [ ] Map token usage to cost using provider pricing data
- [ ] Update `usageBudgetCents` with real cost figures
- [ ] Alert users when approaching budget thresholds
- [ ] Auto-revoke grants that exceed budget caps

### Streaming Support

- [ ] Support Server-Sent Events (SSE) streaming for chat completions
- [ ] Proxy streaming responses from OpenAI and Anthropic
- [ ] Track token usage from streamed responses
- [ ] Handle stream interruption and error recovery

### Multi-Capability Proxying

- [ ] Extend proxy beyond chat to support:
  - Embeddings (`/proxy/embeddings`)
  - Image generation (`/proxy/images`)
  - Audio transcription and synthesis (`/proxy/audio`)
  - Code generation and execution (`/proxy/code`)

---

## Phase 5: Standards and Distribution

**Goal**: Move from a single reference implementation toward a portable, standardized protocol.

### Browser Extension / Wallet Concept

- [ ] Build a browser extension that acts as the user's "AI wallet"
- [ ] Extension intercepts AI access requests on websites
- [ ] Extension presents consent UI in a trusted context (browser chrome, not page content)
- [ ] Extension communicates with a broker (local or remote)
- [ ] Explore WebAuthn integration for consent signing

### Standardized Consent Object Format

- [ ] Define a JSON schema for consent objects that is broker-agnostic
- [ ] Include fields for: requester identity, requested scopes, conditions, user decision, timestamp, signatures
- [ ] Publish the schema as a versioned specification
- [ ] Enable interoperability between different broker implementations

### Draft Specification Document

- [ ] Write a formal specification for the AIPassport protocol
- [ ] Cover: grant request format, consent flow, token issuance, proxy semantics, error codes
- [ ] Align with existing standards (OAuth 2.0, GNAP, UMA) where applicable
- [ ] Submit for community review and feedback

### Audit Logging

- [ ] Log all security-relevant events to an append-only audit trail:
  - Grant creation, approval, denial, revocation
  - Token issuance, usage, expiration, revocation
  - Proxy requests (model, provider, timestamp, response status)
  - Policy violations and denied requests
- [ ] Support structured log export (JSON, SIEM integration)
- [ ] Enable user-facing audit log access through the dashboard

### Multi-Tenant Broker

- [ ] Support multiple users, each with isolated API keys and grants
- [ ] Tenant-scoped storage and access control
- [ ] Admin interface for broker operators
- [ ] Per-tenant billing and usage reporting
- [ ] Horizontal scaling with shared-nothing architecture

---

## Non-Goals (Explicitly Out of Scope)

The following are intentionally excluded from the roadmap:

- **Replacing OAuth 2.0.** AIPassport is complementary to OAuth, not a replacement. User authentication should use standard OAuth/OIDC.
- **Becoming an AI provider.** The broker proxies requests; it does not host models or provide inference.
- **End-to-end encryption of prompts.** The broker must read requests to enforce scopes and route to providers. Prompt privacy is a separate problem.
- **Prompt content moderation.** Content filtering is the responsibility of the upstream provider, not the access delegation layer.

---

## Contributing

This roadmap is a living document. If you have ideas, feedback, or want to contribute to any phase, open an issue or start a discussion in the repository.
