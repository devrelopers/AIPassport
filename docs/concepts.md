---
title: Concepts
layout: default
nav_order: 3
---

# Concepts

## The problem with raw API key sharing

Today, when a website or app wants to use AI on your behalf, the standard approach is to paste your raw API key directly into their interface. This creates several problems:

- **Unrestricted access.** The app can use any model, any capability, and make unlimited requests against your account.
- **No spending controls.** A bug, a compromised app, or a bad actor can drain your provider balance with no cap.
- **Revocation is destructive.** The only way to cut off one app is to rotate the key — which breaks every other app using it.
- **No visibility.** You have no way to see which app used which model, how many requests it made, or what it cost.

This is the equivalent of giving someone your bank login instead of writing them a check for a specific amount.

## Delegated access

AIPassport introduces a delegated access model inspired by OAuth 2.0. Instead of sharing the raw key, a trusted broker mediates access:

- The user's API keys are stored only on the broker, in server-side environment variables.
- Third-party apps receive **delegated tokens** — signed JWTs that prove a grant of access but never contain the raw key.
- The broker **validates tokens**, **enforces scope**, and **proxies requests** to the upstream provider, injecting the real key only at the last moment.

The app never sees, stores, or transmits the raw API key.

## Core concepts

### Grant

A **grant** is the record of a user's consent decision. It specifies:

- Which **provider** the app can access (OpenAI, Anthropic, etc.)
- Which **models** are allowed (e.g., `gpt-4o`, `gpt-4o-mini`)
- Which **capabilities** are permitted (chat, embeddings, images, etc.)
- Optional **request caps** and **budget limits**
- An **expiration time** after which the grant is no longer valid
- A **status**: pending, approved, denied, or revoked

### Delegated token

A **delegated token** is a short-lived, signed JWT issued by the broker for an approved grant. It carries embedded claims:

| Claim | Purpose |
|-------|---------|
| `sub` | The grant ID this token is bound to |
| `jti` | A unique token identifier |
| `iss` | The broker that issued the token |
| `exp` | When the token expires |

The token is cryptographically verified on every request. If the token is expired, revoked, or tampered with, the request is rejected before it reaches the upstream provider.

### Broker

The **broker** is the central server. It:

- Stores provider API keys (never exposes them)
- Manages the grant lifecycle (create, approve, deny, revoke)
- Issues and validates delegated tokens
- Proxies requests to upstream AI providers
- Enforces scope, model allowlists, usage caps, and expiration

### Grant request

A **grant request** is how a third-party app asks for access. It includes the app's name, URL, the requested scope, and a human-readable reason. The user reviews the request and approves or denies it.

## How it compares to OAuth

AIPassport is inspired by OAuth 2.0 but adapted for AI API delegation:

| Concept | OAuth 2.0 | AIPassport |
|---------|-----------|------------|
| What is delegated | Access to a user's data | Access to a user's AI provider |
| Token type | Access token (opaque or JWT) | Signed JWT with grant binding |
| What the token proves | Authorization to act on behalf of a user | Authorization to use a specific provider/model/capability |
| Enforcement | Resource server checks scopes | Broker checks scope, model, capability, budget, and rate |
| Key difference | The API key is the user's own credential | The API key is a third-party provider credential that must never leave the broker |

AIPassport is not a replacement for OAuth. User authentication (who is approving the grant) should use standard OAuth/OIDC. AIPassport handles what happens after the user is authenticated: delegating AI provider access to third-party apps.
