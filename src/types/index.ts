// v0.2.0 — types updated for JWT tokens and SQLite persistence

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const CapabilitySchema = z.enum([
  "chat",
  "embeddings",
  "images",
  "audio",
  "code",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const GrantStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "revoked",
  "expired",
]);
export type GrantStatus = z.infer<typeof GrantStatusSchema>;

export const TokenTypeSchema = z.enum(["bearer", "dpop"]);
export type TokenType = z.infer<typeof TokenTypeSchema>;

// ---------------------------------------------------------------------------
// GrantScope – defines what a relying app is allowed to do
// ---------------------------------------------------------------------------

export const GrantScopeSchema = z.object({
  provider: ProviderSchema,
  /** Specific model IDs the app may use, e.g. ['gpt-4o', 'gpt-4o-mini']. */
  models: z.array(z.string()),
  capabilities: z.array(CapabilitySchema),
  /** Hard spending cap in cents. Prevents runaway costs. */
  maxBudgetCents: z.number().int().nonnegative().optional(),
  /** Maximum number of requests the grant allows. */
  maxRequests: z.number().int().nonnegative().optional(),
  /** Rate limit expressed as requests per minute. */
  rateLimit: z.number().int().nonnegative().optional(),
});
export type GrantScope = z.infer<typeof GrantScopeSchema>;

// ---------------------------------------------------------------------------
// GrantRequest – the initial ask from a relying app before user consent
// ---------------------------------------------------------------------------

export const GrantRequestSchema = z.object({
  id: z.string().uuid(),
  /** Human-readable name of the requesting application. */
  appName: z.string(),
  /** Origin URL of the requesting application – used for CORS & verification. */
  appUrl: z.string().url(),
  scope: GrantScopeSchema,
  /** Plain-language reason shown to the user during the consent prompt. */
  reason: z.string(),
  createdAt: z.string().datetime(),
});
export type GrantRequest = z.infer<typeof GrantRequestSchema>;

// ---------------------------------------------------------------------------
// Grant – persisted record of a user's consent decision and its lifecycle
// ---------------------------------------------------------------------------

export const GrantSchema = z.object({
  id: z.string().uuid(),
  /** Back-reference to the GrantRequest that spawned this grant. */
  requestId: z.string().uuid(),
  appName: z.string(),
  appUrl: z.string().url(),
  scope: GrantScopeSchema,
  status: GrantStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  /** Running count of proxied requests against this grant. */
  usageCount: z.number().int().nonnegative(),
  /** Running total of cents spent against this grant. */
  usageBudgetCents: z.number().int().nonnegative(),
  /** Optional user-supplied notes (e.g. reason for revocation). */
  notes: z.string().optional(),
  /** Schema version for forward compatibility when the grant format evolves. */
  version: z.string().default("1"),
});
export type Grant = z.infer<typeof GrantSchema>;

// ---------------------------------------------------------------------------
// DelegatedToken – short-lived token for an approved grant
//
// Security: the token field holds a signed JWT. It NEVER contains or encodes
// raw API keys.  The server resolves the token to a grant and injects the
// real API key only at proxy time, so the relying app never sees or stores
// the user's credentials.
// ---------------------------------------------------------------------------

export const DelegatedTokenSchema = z.object({
  /** JWT string — never contains or encodes raw API keys. */
  token: z.string(),
  grantId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revoked: z.boolean(),
  /** Token type — 'bearer' today, 'dpop' once DPoP support lands. */
  tokenType: TokenTypeSchema.default("bearer"),
  /** Broker that issued this token — used as the JWT `iss` claim. */
  issuer: z.string().default("aipassport-broker"),
  /** Unique token identifier — used as the JWT `jti` claim. */
  jti: z.string(),
});
export type DelegatedToken = z.infer<typeof DelegatedTokenSchema>;

// ---------------------------------------------------------------------------
// ConsentDecision – the user's approve/deny action on a GrantRequest
// ---------------------------------------------------------------------------

export const ConsentDecisionSchema = z.object({
  requestId: z.string().uuid(),
  approved: z.boolean(),
  /** How long the resulting grant should live, in seconds. Server applies a
   *  default if omitted. */
  expiresInSeconds: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>;

// ---------------------------------------------------------------------------
// ProxyRequest – the payload a relying app sends when proxying a call
//   through AIPassport to an upstream AI provider
// ---------------------------------------------------------------------------

export const MessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const ProxyRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
});
export type ProxyRequest = z.infer<typeof ProxyRequestSchema>;

// ---------------------------------------------------------------------------
// API input-validation schemas
//
// These are intentionally separate from the full object schemas above.
// They validate only the fields the client is responsible for supplying;
// server-generated fields (id, createdAt, etc.) are added server-side.
// ---------------------------------------------------------------------------

/**
 * Validates POST body for creating a new grant request.
 * The server generates `id` and `createdAt`, so they are excluded here.
 */
export const CreateGrantRequestSchema = z.object({
  appName: z.string().min(1),
  appUrl: z.string().url(),
  scope: GrantScopeSchema,
  reason: z.string().min(1),
});
export type CreateGrantRequestInput = z.infer<typeof CreateGrantRequestSchema>;

/**
 * Validates POST body for issuing a delegated token.
 */
export const IssueTokenSchema = z.object({
  grantId: z.string().min(1),
});
export type IssueTokenInput = z.infer<typeof IssueTokenSchema>;
