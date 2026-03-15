import { describe, it, expect, beforeEach } from "vitest";
import {
  addGrantRequest,
  createGrantFromRequest,
  revokeGrant,
  issueToken,
  validateToken,
  incrementUsage,
  resetDb,
  getGrant,
  getDb,
} from "../src/store/index.js";
import crypto from "node:crypto";
import {
  CreateGrantRequestSchema,
  ProxyRequestSchema,
  type GrantRequest,
  type ConsentDecision,
} from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrantRequest(overrides?: Partial<GrantRequest>): GrantRequest {
  return {
    id: crypto.randomUUID(),
    appName: "TestApp",
    appUrl: "https://testapp.example.com",
    scope: {
      provider: "openai",
      models: ["gpt-4o"],
      capabilities: ["chat"],
    },
    reason: "Testing",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function setupApprovedGrant() {
  const req = makeGrantRequest();
  addGrantRequest(req);
  const decision: ConsentDecision = { requestId: req.id, approved: true };
  const grant = createGrantFromRequest(req.id, decision);
  return { req, grant };
}

// ---------------------------------------------------------------------------
// Clear stores between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// Store unit tests
// ---------------------------------------------------------------------------

describe("Store: addGrantRequest", () => {
  it("stores and returns a request", () => {
    const req = makeGrantRequest();
    const result = addGrantRequest(req);

    expect(result).toEqual(req);
    // Verify it was persisted by creating a grant from it (which reads from DB)
    const decision: ConsentDecision = { requestId: req.id, approved: true };
    const grant = createGrantFromRequest(req.id, decision);
    expect(grant.requestId).toBe(req.id);
  });
});

describe("Store: createGrantFromRequest", () => {
  it("creates an approved grant", () => {
    const req = makeGrantRequest();
    addGrantRequest(req);

    const decision: ConsentDecision = { requestId: req.id, approved: true };
    const grant = createGrantFromRequest(req.id, decision);

    expect(grant.status).toBe("approved");
    expect(grant.requestId).toBe(req.id);
    expect(grant.appName).toBe(req.appName);
    expect(grant.approvedAt).toBeDefined();
    expect(grant.usageCount).toBe(0);
    expect(new Date(grant.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("creates a denied grant", () => {
    const req = makeGrantRequest();
    addGrantRequest(req);

    const decision: ConsentDecision = { requestId: req.id, approved: false };
    const grant = createGrantFromRequest(req.id, decision);

    expect(grant.status).toBe("denied");
    expect(grant.approvedAt).toBeUndefined();
  });

  it("throws for unknown requestId", () => {
    const decision: ConsentDecision = {
      requestId: crypto.randomUUID(),
      approved: true,
    };
    expect(() => createGrantFromRequest(decision.requestId, decision)).toThrow(
      /not found/,
    );
  });

  it("respects custom expiresInSeconds", () => {
    const req = makeGrantRequest();
    addGrantRequest(req);

    const before = Date.now();
    const decision: ConsentDecision = {
      requestId: req.id,
      approved: true,
      expiresInSeconds: 7200,
    };
    const grant = createGrantFromRequest(req.id, decision);

    const expiresMs = new Date(grant.expiresAt).getTime();
    // Should expire roughly 7200s from now (allow 5s tolerance)
    expect(expiresMs).toBeGreaterThanOrEqual(before + 7200 * 1000 - 5000);
    expect(expiresMs).toBeLessThanOrEqual(before + 7200 * 1000 + 5000);
  });
});

describe("Store: revokeGrant", () => {
  it("changes status to revoked and revokes associated tokens", async () => {
    const { grant } = await setupApprovedGrant();
    const token = await issueToken(grant.id);

    const revoked = revokeGrant(grant.id);

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeDefined();

    // Verify the token was revoked in the DB
    const row = getDb()
      .prepare("SELECT revoked FROM tokens WHERE jti = ?")
      .get(token.jti) as { revoked: number };
    expect(row.revoked).toBe(1);
  });

  it("throws for unknown grant id", () => {
    expect(() => revokeGrant(crypto.randomUUID())).toThrow(/not found/);
  });
});

describe("Store: issueToken", () => {
  it("creates a valid token for an approved grant", async () => {
    const { grant } = await setupApprovedGrant();
    const token = await issueToken(grant.id);

    expect(token.grantId).toBe(grant.id);
    expect(token.revoked).toBe(false);
    expect(token.token).toBeTruthy();
    expect(token.tokenType).toBe("bearer");
    expect(token.issuer).toBe("aipassport-broker");
    expect(token.jti).toBeTruthy();
    expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("throws for unknown grant id", async () => {
    await expect(issueToken(crypto.randomUUID())).rejects.toThrow(/not found/);
  });
});

describe("Store: validateToken", () => {
  it("returns valid for a good token", async () => {
    const { grant } = await setupApprovedGrant();
    const token = await issueToken(grant.id);

    const result = await validateToken(token.token);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.grant.id).toBe(grant.id);
    }
  });

  it("returns invalid for unknown token", async () => {
    const result = await validateToken("nonexistent");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/invalid|not found/i);
    }
  });

  it("returns invalid for expired tokens", async () => {
    // Issue a token with a 1-second TTL so it expires quickly
    const origTtl = process.env.TOKEN_TTL_SECONDS;
    process.env.TOKEN_TTL_SECONDS = "1";
    try {
      const { grant } = await setupApprovedGrant();
      const token = await issueToken(grant.id);

      // Wait for the JWT to actually expire
      await new Promise((r) => setTimeout(r, 1500));

      const result = await validateToken(token.token);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toMatch(/expired|invalid/i);
      }
    } finally {
      if (origTtl === undefined) {
        delete process.env.TOKEN_TTL_SECONDS;
      } else {
        process.env.TOKEN_TTL_SECONDS = origTtl;
      }
    }
  });

  it("returns invalid for revoked tokens", async () => {
    const { grant } = await setupApprovedGrant();
    const token = await issueToken(grant.id);

    // Manually revoke the token in SQLite
    getDb()
      .prepare("UPDATE tokens SET revoked = 1 WHERE jti = ?")
      .run(token.jti);

    const result = await validateToken(token.token);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/revoked/i);
    }
  });

  it("returns invalid when grant is revoked", async () => {
    const { grant } = await setupApprovedGrant();
    const token = await issueToken(grant.id);
    revokeGrant(grant.id);

    const result = await validateToken(token.token);
    expect(result.valid).toBe(false);
  });
});

describe("Store: incrementUsage", () => {
  it("increments usage count", async () => {
    const { grant } = await setupApprovedGrant();

    expect(incrementUsage(grant.id)).toBe(true);
    expect(getGrant(grant.id)!.usageCount).toBe(1);

    expect(incrementUsage(grant.id)).toBe(true);
    expect(getGrant(grant.id)!.usageCount).toBe(2);
  });

  it("returns false when maxRequests cap is exceeded", () => {
    const req = makeGrantRequest({
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
        maxRequests: 2,
      },
    });
    addGrantRequest(req);
    const decision: ConsentDecision = { requestId: req.id, approved: true };
    const grant = createGrantFromRequest(req.id, decision);

    expect(incrementUsage(grant.id)).toBe(true); // count=1
    expect(incrementUsage(grant.id)).toBe(true); // count=2
    expect(incrementUsage(grant.id)).toBe(false); // count=3, exceeds cap of 2
  });

  it("returns false when maxBudgetCents cap is exceeded", () => {
    const req = makeGrantRequest({
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
        maxBudgetCents: 100,
      },
    });
    addGrantRequest(req);
    const decision: ConsentDecision = { requestId: req.id, approved: true };
    const grant = createGrantFromRequest(req.id, decision);

    // Simulate spending over budget directly in SQLite
    getDb()
      .prepare("UPDATE grants SET usage_budget_cents = ? WHERE id = ?")
      .run(101, grant.id);

    expect(incrementUsage(grant.id)).toBe(false);
  });

  it("throws for unknown grant id", () => {
    expect(() => incrementUsage(crypto.randomUUID())).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Type validation tests
// ---------------------------------------------------------------------------

describe("Schema: CreateGrantRequestSchema", () => {
  it("accepts valid input", () => {
    const input = {
      appName: "MyApp",
      appUrl: "https://myapp.com",
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
      },
      reason: "Need AI for summarization",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects missing appName", () => {
    const input = {
      appUrl: "https://myapp.com",
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
      },
      reason: "Need AI",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects empty appName", () => {
    const input = {
      appName: "",
      appUrl: "https://myapp.com",
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
      },
      reason: "Need AI",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid appUrl", () => {
    const input = {
      appName: "MyApp",
      appUrl: "not-a-url",
      scope: {
        provider: "openai",
        models: ["gpt-4o"],
        capabilities: ["chat"],
      },
      reason: "Need AI",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const input = {
      appName: "MyApp",
      appUrl: "https://myapp.com",
      scope: {
        provider: "invalid-provider",
        models: ["gpt-4o"],
        capabilities: ["chat"],
      },
      reason: "Need AI",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts optional scope fields", () => {
    const input = {
      appName: "MyApp",
      appUrl: "https://myapp.com",
      scope: {
        provider: "anthropic",
        models: ["claude-3-opus"],
        capabilities: ["chat", "code"],
        maxBudgetCents: 500,
        maxRequests: 100,
        rateLimit: 10,
      },
      reason: "Need AI for code generation",
    };

    const result = CreateGrantRequestSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("Schema: ProxyRequestSchema", () => {
  it("accepts valid proxy request", () => {
    const input = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    };

    const result = ProxyRequestSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects missing model", () => {
    const input = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = ProxyRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing messages", () => {
    const input = { model: "gpt-4o" };

    const result = ProxyRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects malformed messages", () => {
    const input = {
      model: "gpt-4o",
      messages: [{ role: "user" }], // missing content
    };

    const result = ProxyRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
