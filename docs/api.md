---
title: API Reference
layout: default
nav_order: 5
---

# API Reference

All endpoints are served by the broker at `http://localhost:3001` by default. Request and response bodies are JSON.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/grant-requests` | Create a new grant request |
| `POST` | `/grants/:id/approve` | Approve a pending grant |
| `POST` | `/grants/:id/deny` | Deny a pending grant |
| `GET` | `/grants` | List all grants |
| `GET` | `/grants/:id` | Get a single grant |
| `POST` | `/grants/:id/revoke` | Revoke a grant and invalidate its tokens |
| `POST` | `/tokens` | Issue a delegated JWT for an approved grant |
| `GET` | `/tokens/:token/inspect` | Inspect a token's validity |
| `POST` | `/proxy/chat` | Proxy a chat request to the upstream provider |
| `GET` | `/health` | Health check |

---

## Grant requests

### POST /grant-requests

Create a new grant request. This is how a third-party app asks for delegated access.

**Request body:**

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

**Scope fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | `"openai"`, `"anthropic"`, or `"google"` |
| `models` | string[] | Yes | Allowed model IDs |
| `capabilities` | string[] | Yes | `"chat"`, `"embeddings"`, `"images"`, `"audio"`, `"code"` |
| `maxBudgetCents` | number | No | Spending cap in cents |
| `maxRequests` | number | No | Maximum number of proxied requests |
| `rateLimit` | number | No | Requests per minute (defined but not yet enforced) |

**Response:** `201 Created`

```json
{
  "grantRequest": { "id": "...", "appName": "...", ... },
  "grant": { "id": "...", "status": "pending", ... }
}
```

---

## Grant management

### POST /grants/:id/approve

Approve a pending grant. Optionally set a custom expiration.

**Request body (optional):**

```json
{ "expiresInSeconds": 7200 }
```

Default expiration is 3600 seconds (1 hour).

**Response:** `200 OK` with the updated grant object.

### POST /grants/:id/deny

Deny a pending grant.

**Response:** `200 OK` with the updated grant object.

### POST /grants/:id/revoke

Revoke an approved grant. All tokens issued for this grant are immediately invalidated.

**Response:** `200 OK` with the updated grant object.

### GET /grants

List all grants, sorted by creation date (newest first).

**Response:** `200 OK` with an array of grant objects.

### GET /grants/:id

Get a single grant by ID.

**Response:** `200 OK` with the grant object, or `404` if not found.

---

## Tokens

### POST /tokens

Issue a signed JWT delegated token for an approved grant.

**Request body:**

```json
{ "grantId": "..." }
```

**Response:** `201 Created`

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "grantId": "...",
  "issuedAt": "2026-03-15T12:00:00.000Z",
  "expiresAt": "2026-03-15T13:00:00.000Z"
}
```

The `token` field is a signed JWT. It never contains the raw provider API key.

### GET /tokens/:token/inspect

Inspect a token's validity and associated grant metadata. Useful for debugging.

**Response:** `200 OK`

```json
{
  "valid": true,
  "grant": {
    "id": "...",
    "appName": "...",
    "scope": { ... },
    "status": "approved",
    "usageCount": 5
  }
}
```

---

## Proxy

### POST /proxy/chat

Proxy a chat completion request to the upstream AI provider. The broker validates the token, checks scopes and usage caps, injects the real API key, and forwards the request.

**Headers:**

```
Authorization: Bearer <delegated-token>
Content-Type: application/json
```

**Request body:**

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

**Response:** The upstream provider's response, proxied through.

**Error responses:**

| Status | Meaning |
|--------|---------|
| `400` | Invalid request body (missing model or messages) |
| `401` | Missing, malformed, expired, or revoked token |
| `429` | Usage cap exceeded |
| `502` | Upstream provider error |

**Example with curl:**

```bash
curl -X POST http://localhost:3001/proxy/chat \
  -H "Authorization: Bearer <delegated-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Health

### GET /health

Returns broker status.

**Response:** `200 OK`

```json
{ "status": "ok", "service": "aipassport-broker" }
```
