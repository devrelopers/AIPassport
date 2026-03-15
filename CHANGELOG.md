# Changelog

All notable changes to AIPassport are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-03-15 - patch

### Added
- `getProviderKey()` now accepts common env var aliases per provider (e.g. `CLAUDE_API_KEY`, `CLAUDE_KEY`, `GEMINI_API_KEY`) so users don't need to rename existing keys

### Changed
- `.env.example` updated to document all accepted alias names per provider

### Fixed
- Clarified that `/proxy/chat` is the single proxy endpoint — provider routing is determined by the grant scope, not the URL path (there is no `/proxy/anthropic` or `/proxy/openai`)

---

## [0.2.0] - 2026-03-15

### Added
- SQLite persistence via better-sqlite3 -- grants, tokens, and requests now survive server restarts
- Signed JWT delegated tokens (HS256) via jose -- tokens carry embedded claims (sub, jti, iss, exp) and are cryptographically verified before any database lookup
- `JWT_SECRET` environment variable for configurable signing key (auto-generated if not set)
- Token `jti` (unique identifier), `tokenType` (bearer/dpop), and `issuer` fields for future standardization
- Grant `version` field for forward-compatible schema evolution
- Security banner in the demo UI explaining the key protection model
- `resetDb()` and `getDb()` test helpers for SQLite-backed tests
- `getGrant()` and `getAllGrants()` store functions

### Changed
- Replaced in-memory Map stores with SQLite tables (`grant_requests`, `grants`, `tokens`)
- Replaced opaque UUID tokens with signed HS256 JWTs
- `issueToken()` and `validateToken()` are now async (JWT signing/verification)
- Token validation now checks JWT signature and expiration cryptographically before database lookup
- Updated demo UI copy to clarify the security model and JWT token usage
- Removed `uuid` dependency in favor of built-in `crypto.randomUUID()`

### Security
- Delegated tokens are now cryptographically signed -- tampering or forging tokens requires the server's signing key
- Token expiration is enforced both in the JWT `exp` claim and in the database record

## [0.1.0] - 2026-03-15

### Added
- Express/TypeScript broker server with Zod-validated API
- In-memory store for grants, tokens, and requests
- Grant lifecycle: create, approve, deny, revoke, list
- Opaque UUID delegated token issuance and validation
- Upstream proxy to OpenAI (chat completions) and Anthropic (messages)
- Mock proxy for Google provider
- Model allowlist and capability restriction enforcement per grant
- Usage counting with request cap enforcement
- Budget cap field (not yet wired to real cost data)
- Rate limit field (not yet enforced at middleware level)
- Token introspection endpoint
- Grant revocation with cascading token invalidation
- Demo UI with three tabs: Request Access, Consent & Grants, Try It
- Health check endpoint
- Zod validation middleware
- 28 unit tests covering store operations and schema validation
- README, architecture docs, and roadmap
