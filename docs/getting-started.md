---
title: Getting Started
layout: default
nav_order: 2
---

# Getting Started

AIPassport runs locally with Node.js. No Docker, no cloud services required.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

## Setup

```bash
git clone https://github.com/devrelopers/AIPassport.git
cd AIPassport
npm install
cp .env.example .env
```

Edit `.env` and add at least one provider API key:

```bash
OPENAI_API_KEY=sk-your-key-here
# or
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

## Run the broker

```bash
npm run dev
```

The broker starts at [http://localhost:3001](http://localhost:3001). Open it in a browser to see the demo UI.

## Try the demo flow

The demo UI has three tabs:

1. **Request Access** — simulate a third-party app requesting delegated AI access
2. **Consent & Grants** — review pending requests, approve or deny, and manage active grants
3. **Try It** — get a signed JWT token for an approved grant and make a proxied AI call

### Quick walkthrough

1. On the **Request Access** tab, fill in an app name and click **Submit Grant Request**
2. Switch to **Consent & Grants** and click **Approve** on the pending grant
3. Switch to **Try It**, select the approved grant, and click **Get Token**
4. Type a message and click **Send via Proxy** to make an AI call through the broker

The broker validates the token, checks scopes, injects your real API key server-side, and returns the AI response. The demo app never sees your raw key.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | — |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | — |
| `GOOGLE_API_KEY` | Your Google AI API key | — |
| `PORT` | Server port | `3001` |
| `TOKEN_TTL_SECONDS` | Default token lifetime in seconds | `3600` |
| `JWT_SECRET` | HMAC secret for signing JWT tokens | Auto-generated |

At least one provider API key is required for the proxy to work. If `JWT_SECRET` is not set, a random key is generated on startup — tokens will not survive server restarts.

## Run tests

```bash
npm test
```

The test suite includes 57 tests: 28 store-level unit tests and 29 HTTP integration tests.

## Project structure

```
AIPassport/
├── src/
│   ├── app.ts                # Express app setup
│   ├── server.ts             # Entry point (imports app, starts listening)
│   ├── types/index.ts        # Core types & Zod schemas
│   ├── store/index.ts        # SQLite data store & business logic
│   ├── routes/
│   │   ├── grants.ts         # Grant request & management API
│   │   ├── tokens.ts         # Token issuance & inspection API
│   │   └── proxy.ts          # AI proxy endpoint
│   ├── middleware/
│   │   └── validate.ts       # Zod validation middleware
│   └── lib/
│       └── proxy.ts          # Upstream provider proxy
├── public/
│   └── index.html            # Demo UI
├── tests/                    # Test suite
├── docs/                     # Documentation site (this site)
├── .env.example              # Environment variable template
├── package.json
├── tsconfig.json
└── LICENSE
```
