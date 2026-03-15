# AIPassport - OAuth-Inspired Delegated AI Access

**Stop sharing raw API keys with every website that wants to use AI on your behalf.**

AIPassport is a broker that lets users delegate scoped, time-limited, revocable access to their AI providers -- without ever exposing their raw API keys. Think of it as OAuth for AI APIs: the website gets a short-lived token, the broker enforces the rules, and your real credentials never leave a server you control.

## The Problem

Today, when a website wants to use AI on your behalf, you paste your raw API key directly into their app. This means:

- The app has **unrestricted access** to your AI provider account
- There is **no spending cap** -- a bug or bad actor can drain your balance
- You **cannot revoke** access without rotating the key (which breaks every other app using it)
- You have **no visibility** into what models or capabilities each app is actually using

## How AIPassport Solves It

AIPassport sits between the requesting app and your AI provider. Instead of handing over your API key, you grant the app a **scoped, time-limited, revocable JWT** through a consent flow:

```
  Requesting App                AIPassport Broker              AI Provider
  ──────────────                ────────────────               ───────────
        │                              │                            │
        │  1. POST /grant-requests     │                            │
        │  "I need chat access to      │                            │
        │   GPT-4o for 1 hour"         │                            │
        │ ──────────────────────────►  │                            │
        │                              │                            │
        │  2. User reviews & approves  │                            │
        │     via consent UI           │                            │
        │  ◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │                            │
        │                              │                            │
        │  3. POST /tokens             │                            │
        │  ──────────────────────────► │                            │
        │  ◄── signed JWT token ─────  │                            │
        │                              │                            │
        │  4. POST /proxy/chat         │  5. Inject real API key    │
        │     Authorization: Bearer    │     & forward request      │
        │     <delegated-token>        │ ──────────────────────────►│
        │  ──────────────────────────► │                            │
        │                              │  ◄── AI response ─────────│
        │  ◄── proxied response ─────  │                            │
        │                              │                            │
```

The requesting app **never sees your raw API key**. The broker validates the token, checks scopes and usage caps, injects the real credential at proxy time, and returns the response.

## Key Security Properties

- **Raw API keys never leave the broker.** They are stored in server-side environment variables and injected only at the point of the upstream request.
- **Short-lived delegated tokens.** Tokens expire automatically (default: 1 hour). Even if intercepted, the window of exposure is limited.
- **Per-app, per-grant scoping.** Each grant specifies the provider, allowed models, capabilities, budget caps, and request limits.
- **Revocable at any time.** Users can revoke a grant instantly; all associated tokens are invalidated immediately.
- **Centralized validation and enforcement.** Every proxied request passes through token validation, scope checks, and usage accounting before reaching the upstream provider.

## MVP Architecture

This reference implementation is built with:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Broker server | Express + TypeScript | API endpoints, routing, middleware |
| Data store | SQLite (better-sqlite3) | Persistent grant, token, and request storage |
| Token signing | jose (HS256 JWT) | Signed delegated tokens with embedded claims |
| Validation | Zod schemas | Request body validation and type safety |
| Frontend | Static HTML | Demo consent UI and dashboard |
| Proxy | Node `fetch` | Upstream calls to OpenAI, Anthropic |

SQLite provides persistence across restarts. The store layer can be replaced with Postgres for multi-instance deployments.

## Project Structure

```
AIPassport/
├── src/
│   ├── server.ts              # Entry point, Express app setup
│   ├── types/index.ts         # Core types & Zod schemas
│   ├── store/index.ts         # SQLite data store & business logic
│   ├── routes/
│   │   ├── grants.ts          # Grant request & management API
│   │   ├── tokens.ts          # Token issuance & inspection API
│   │   └── proxy.ts           # AI proxy endpoint
│   ├── middleware/
│   │   └── validate.ts        # Zod validation middleware
│   └── lib/
│       └── proxy.ts           # Upstream provider proxy (security boundary)
├── public/
│   └── index.html             # Demo UI
├── tests/                     # Test suite
├── docs/
│   ├── architecture.md        # Detailed architecture document
│   └── roadmap.md             # Future development roadmap
├── .env.example               # Environment variable template
├── package.json
├── tsconfig.json
└── LICENSE
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/grant-requests` | Create a new grant request (app requests access) |
| `POST` | `/grants/:id/approve` | Approve a pending grant (user consents) |
| `POST` | `/grants/:id/deny` | Deny a pending grant (user declines) |
| `GET` | `/grants` | List all grants (sorted by creation date) |
| `GET` | `/grants/:id` | Get a single grant by ID |
| `POST` | `/grants/:id/revoke` | Revoke an approved grant and all its tokens |
| `POST` | `/tokens` | Issue a delegated token for an approved grant |
| `GET` | `/tokens/:token/inspect` | Inspect a token's validity and associated grant |
| `POST` | `/proxy/chat` | Proxy a chat completion request to the upstream provider |
| `GET` | `/health` | Health check |

### Grant Request Body

```json
{
  "appName": "My AI App",
  "appUrl": "https://myapp.example.com",
  "scope": {
    "provider": "openai",
    "models": ["gpt-4o", "gpt-4o-mini"],
    "capabilities": ["chat"],
    "maxBudgetCents": 500,
    "maxRequests": 100,
    "rateLimit": 10
  },
  "reason": "Chat assistant feature"
}
```

### Proxy Request

```bash
curl -X POST http://localhost:3001/proxy/chat \
  -H "Authorization: Bearer <delegated-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

```bash
git clone https://github.com/devrelopers/AIPassport.git
cd AIPassport
npm install
cp .env.example .env
# Edit .env with your actual API keys
npm run dev
# Broker is running at http://localhost:3001
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | -- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | -- |
| `PORT` | Server port | `3001` |
| `TOKEN_TTL_SECONDS` | Default token lifetime in seconds | `3600` |
| `GOOGLE_API_KEY` | Your Google AI API key | -- |
| `JWT_SECRET` | HMAC secret for signing JWT tokens | Auto-generated |

> **Note:** At least one provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`) is needed for the proxy to work.

## Security Caveats

This is an **exploratory reference implementation**. The following limitations apply:

- **No user authentication.** The broker does not verify who is approving grants. Any caller can approve or deny.
- **Single-server signing key.** JWT signing uses a server-local HMAC key. For multi-instance deployments, set `JWT_SECRET` to a shared value or migrate to asymmetric keys.
- **No TLS enforcement.** The broker does not require HTTPS. In production, all traffic must be encrypted.
- **No rate limiting infrastructure.** The `rateLimit` scope field is defined but not enforced at the middleware level.
- **No audit logging.** Grant approvals, token issuances, and proxied requests are not logged to a persistent audit trail.

**Do not use this in production.** See the [roadmap](docs/roadmap.md) for the path toward production readiness.

## Status

**v0.2.0** -- reference implementation with SQLite persistence and signed JWT tokens, demonstrating the delegated AI access pattern. This is not a final standard -- it is a starting point for discussion and iteration.

## Documentation

- [Architecture](docs/architecture.md) -- system design, security boundaries, data flows, and trust model
- [Roadmap](docs/roadmap.md) -- phased plan from MVP to production-grade system
- [Changelog](CHANGELOG.md) -- version history
- [Security](SECURITY.md) -- security model and responsible disclosure

## Contributing

This is an early-stage project. Contributions, feedback, and discussion are welcome. Please open an issue before submitting large changes.

## License

MIT License. See [LICENSE](LICENSE) for details.
