// v0.2.0 — SQLite persistence with JWT delegated tokens.

import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import * as jose from "jose";
import {
  type GrantRequest,
  type Grant,
  type GrantScope,
  type DelegatedToken,
  type ConsentDecision,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, "aipassport.db");
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS grant_requests (
      id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL,
      app_url TEXT NOT NULL,
      scope TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      app_url TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      version TEXT NOT NULL DEFAULT '1',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      revoked_at TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      usage_budget_cents INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      jti TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      token_type TEXT NOT NULL DEFAULT 'bearer',
      issuer TEXT NOT NULL DEFAULT 'aipassport-broker',
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
}

createTables();

// ---------------------------------------------------------------------------
// JWT signing key (lazy init)
// ---------------------------------------------------------------------------

let signingKey: Uint8Array | null = null;

export async function getSigningKey(): Promise<Uint8Array> {
  if (signingKey) return signingKey;

  if (process.env.JWT_SECRET) {
    signingKey = new TextEncoder().encode(process.env.JWT_SECRET);
  } else {
    signingKey = (await jose.generateSecret("HS256")) as Uint8Array;
  }
  return signingKey;
}

// ---------------------------------------------------------------------------
// Row ↔ Type helpers
// ---------------------------------------------------------------------------

interface GrantRequestRow {
  id: string;
  app_name: string;
  app_url: string;
  scope: string;
  reason: string;
  created_at: string;
}

interface GrantRow {
  id: string;
  request_id: string;
  app_name: string;
  app_url: string;
  scope: string;
  status: string;
  version: string;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  revoked_at: string | null;
  usage_count: number;
  usage_budget_cents: number;
  notes: string | null;
}

interface TokenRow {
  jti: string;
  token: string;
  grant_id: string;
  token_type: string;
  issuer: string;
  issued_at: string;
  expires_at: string;
  revoked: number;
}

function rowToGrantRequest(row: GrantRequestRow): GrantRequest {
  return {
    id: row.id,
    appName: row.app_name,
    appUrl: row.app_url,
    scope: JSON.parse(row.scope) as GrantScope,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function rowToGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    requestId: row.request_id,
    appName: row.app_name,
    appUrl: row.app_url,
    scope: JSON.parse(row.scope) as GrantScope,
    status: row.status as Grant["status"],
    version: row.version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    usageCount: row.usage_count,
    usageBudgetCents: row.usage_budget_cents,
    notes: row.notes ?? undefined,
  };
}

function rowToToken(row: TokenRow): DelegatedToken {
  return {
    token: row.token,
    grantId: row.grant_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revoked: row.revoked === 1,
    tokenType: row.token_type as DelegatedToken["tokenType"],
    issuer: row.issuer,
    jti: row.jti,
  };
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmts = {
  insertGrantRequest: db.prepare(`
    INSERT INTO grant_requests (id, app_name, app_url, scope, reason, created_at)
    VALUES (@id, @app_name, @app_url, @scope, @reason, @created_at)
  `),

  getGrantRequest: db.prepare(`SELECT * FROM grant_requests WHERE id = ?`),

  insertGrant: db.prepare(`
    INSERT INTO grants (id, request_id, app_name, app_url, scope, status, version, created_at, expires_at, approved_at, revoked_at, usage_count, usage_budget_cents, notes)
    VALUES (@id, @request_id, @app_name, @app_url, @scope, @status, @version, @created_at, @expires_at, @approved_at, @revoked_at, @usage_count, @usage_budget_cents, @notes)
  `),

  getGrant: db.prepare(`SELECT * FROM grants WHERE id = ?`),

  getActiveGrants: db.prepare(`
    SELECT * FROM grants
    WHERE status = 'approved' AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `),

  getAllGrants: db.prepare(`SELECT * FROM grants ORDER BY created_at DESC`),

  updateGrantStatus: db.prepare(`
    UPDATE grants SET status = @status, revoked_at = @revoked_at WHERE id = @id
  `),

  incrementUsage: db.prepare(`
    UPDATE grants SET usage_count = usage_count + 1 WHERE id = ?
  `),

  insertToken: db.prepare(`
    INSERT INTO tokens (jti, token, grant_id, token_type, issuer, issued_at, expires_at, revoked)
    VALUES (@jti, @token, @grant_id, @token_type, @issuer, @issued_at, @expires_at, @revoked)
  `),

  getTokenByJti: db.prepare(`SELECT * FROM tokens WHERE jti = ?`),

  revokeTokensByGrantId: db.prepare(`
    UPDATE tokens SET revoked = 1 WHERE grant_id = ?
  `),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function addGrantRequest(req: GrantRequest): GrantRequest {
  stmts.insertGrantRequest.run({
    id: req.id,
    app_name: req.appName,
    app_url: req.appUrl,
    scope: JSON.stringify(req.scope),
    reason: req.reason,
    created_at: req.createdAt,
  });
  return req;
}

/**
 * Creates a Grant from a GrantRequest + ConsentDecision.
 *
 * - If approved: status = 'approved', expiresAt computed from
 *   decision.expiresInSeconds (default 3600).
 * - If denied: status = 'denied', expiresAt set to now (immediately expired).
 */
export function createGrantFromRequest(
  requestId: string,
  decision: ConsentDecision,
): Grant {
  const row = stmts.getGrantRequest.get(requestId) as
    | GrantRequestRow
    | undefined;
  if (!row) {
    throw new Error(`GrantRequest ${requestId} not found`);
  }
  const request = rowToGrantRequest(row);

  const now = new Date();
  const approved = decision.approved;
  const ttlSeconds = decision.expiresInSeconds ?? 3600;
  const expiresAt = approved
    ? new Date(now.getTime() + ttlSeconds * 1000)
    : now;

  const grant: Grant = {
    id: crypto.randomUUID(),
    requestId,
    appName: request.appName,
    appUrl: request.appUrl,
    scope: request.scope,
    status: approved ? "approved" : "denied",
    version: "1",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvedAt: approved ? now.toISOString() : undefined,
    usageCount: 0,
    usageBudgetCents: 0,
    notes: decision.notes,
  };

  stmts.insertGrant.run({
    id: grant.id,
    request_id: grant.requestId,
    app_name: grant.appName,
    app_url: grant.appUrl,
    scope: JSON.stringify(grant.scope),
    status: grant.status,
    version: grant.version,
    created_at: grant.createdAt,
    expires_at: grant.expiresAt,
    approved_at: grant.approvedAt ?? null,
    revoked_at: grant.revokedAt ?? null,
    usage_count: grant.usageCount,
    usage_budget_cents: grant.usageBudgetCents,
    notes: grant.notes ?? null,
  });

  return grant;
}

/**
 * Returns grants that are approved and not yet expired.
 */
export function getActiveGrants(): Grant[] {
  const rows = stmts.getActiveGrants.all() as GrantRow[];
  return rows.map(rowToGrant);
}

/**
 * Returns a single grant by ID, or undefined if not found.
 */
export function getGrant(id: string): Grant | undefined {
  const row = stmts.getGrant.get(id) as GrantRow | undefined;
  return row ? rowToGrant(row) : undefined;
}

/**
 * Returns all grants sorted by created_at descending.
 */
export function getAllGrants(): Grant[] {
  const rows = stmts.getAllGrants.all() as GrantRow[];
  return rows.map(rowToGrant);
}

/**
 * Revokes a grant and all tokens issued against it.
 */
export function revokeGrant(id: string): Grant {
  const row = stmts.getGrant.get(id) as GrantRow | undefined;
  if (!row) {
    throw new Error(`Grant ${id} not found`);
  }

  const now = new Date().toISOString();
  stmts.updateGrantStatus.run({ id, status: "revoked", revoked_at: now });
  stmts.revokeTokensByGrantId.run(id);

  const updated = stmts.getGrant.get(id) as GrantRow;
  return rowToGrant(updated);
}

/**
 * Issues a short-lived DelegatedToken (JWT) for an approved grant.
 * TTL is read from env TOKEN_TTL_SECONDS (default 3600).
 */
export async function issueToken(grantId: string): Promise<DelegatedToken> {
  const grantRow = stmts.getGrant.get(grantId) as GrantRow | undefined;
  if (!grantRow) {
    throw new Error(`Grant ${grantId} not found`);
  }

  const ttl = parseInt(process.env.TOKEN_TTL_SECONDS ?? "3600", 10);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const jti = crypto.randomUUID();

  const key = await getSigningKey();
  const jwt = await new jose.SignJWT({ sub: grantId, jti, iss: "aipassport-broker", grantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(jti)
    .setIssuer("aipassport-broker")
    .setSubject(grantId)
    .sign(key);

  const delegatedToken: DelegatedToken = {
    token: jwt,
    grantId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revoked: false,
    tokenType: "bearer",
    issuer: "aipassport-broker",
    jti,
  };

  stmts.insertToken.run({
    jti,
    token: jwt,
    grant_id: grantId,
    token_type: "bearer",
    issuer: "aipassport-broker",
    issued_at: delegatedToken.issuedAt,
    expires_at: delegatedToken.expiresAt,
    revoked: 0,
  });

  return delegatedToken;
}

/**
 * Validates a JWT bearer token string. Checks:
 * 1. JWT signature and expiration are valid
 * 2. Token exists in the database
 * 3. Token is not revoked
 * 4. Associated grant is still approved and not expired
 */
export async function validateToken(
  tokenString: string,
): Promise<{ valid: true; grant: Grant } | { valid: false; reason: string }> {
  let payload: jose.JWTPayload;
  try {
    const key = await getSigningKey();
    const result = await jose.jwtVerify(tokenString, key, {
      issuer: "aipassport-broker",
    });
    payload = result.payload;
  } catch {
    return { valid: false, reason: "Invalid or expired JWT" };
  }

  const jti = payload.jti;
  const grantId = (payload as Record<string, unknown>).grantId as
    | string
    | undefined;

  if (!jti || !grantId) {
    return { valid: false, reason: "JWT missing required claims" };
  }

  // Look up token in DB
  const tokenRow = stmts.getTokenByJti.get(jti) as TokenRow | undefined;
  if (!tokenRow) {
    return { valid: false, reason: "Token not found" };
  }
  if (tokenRow.revoked === 1) {
    return { valid: false, reason: "Token has been revoked" };
  }

  // Look up grant
  const grantRow = stmts.getGrant.get(grantId) as GrantRow | undefined;
  if (!grantRow) {
    return { valid: false, reason: "Associated grant not found" };
  }

  const grant = rowToGrant(grantRow);

  if (grant.status !== "approved") {
    return { valid: false, reason: `Grant status is '${grant.status}'` };
  }

  const now = new Date();
  if (new Date(grant.expiresAt) <= now) {
    return { valid: false, reason: "Associated grant has expired" };
  }

  return { valid: true, grant };
}

/**
 * Increments usageCount on a grant and checks whether the grant is still
 * within its budget/request caps.
 *
 * Returns `true` if the grant is still within limits, `false` if a cap has
 * been reached or exceeded.
 */
export function incrementUsage(grantId: string): boolean {
  const grantRow = stmts.getGrant.get(grantId) as GrantRow | undefined;
  if (!grantRow) {
    throw new Error(`Grant ${grantId} not found`);
  }

  stmts.incrementUsage.run(grantId);

  // Re-read the updated row
  const updated = stmts.getGrant.get(grantId) as GrantRow;
  const grant = rowToGrant(updated);

  // Check request cap
  if (
    grant.scope.maxRequests !== undefined &&
    grant.usageCount > grant.scope.maxRequests
  ) {
    return false;
  }

  // Check budget cap
  if (
    grant.scope.maxBudgetCents !== undefined &&
    grant.usageBudgetCents > grant.scope.maxBudgetCents
  ) {
    return false;
  }

  return true;
}

/**
 * Reads the upstream API key for a given provider from environment variables.
 * This is the ONLY place raw keys are accessed.
 */
export function getProviderKey(provider: string): string | undefined {
  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
  };

  const envVar = envMap[provider];
  if (!envVar) return undefined;
  return process.env[envVar];
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/**
 * Returns the database instance (for testing).
 */
export function getDb(): ReturnType<typeof Database> {
  return db;
}

/**
 * Drops all tables and recreates them (for testing).
 */
export function resetDb(): void {
  db.exec(`
    DROP TABLE IF EXISTS tokens;
    DROP TABLE IF EXISTS grants;
    DROP TABLE IF EXISTS grant_requests;
  `);
  createTables();
}
