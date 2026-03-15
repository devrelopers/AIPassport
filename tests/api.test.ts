import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { resetDb } from "../src/store/index.js";

// ---------------------------------------------------------------------------
// Reset database between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validGrantBody = {
  appName: "TestApp",
  appUrl: "https://testapp.example.com",
  scope: {
    provider: "openai",
    models: ["gpt-4o"],
    capabilities: ["chat"],
  },
  reason: "Integration testing",
};

async function createAndApproveGrant() {
  const createRes = await request(app)
    .post("/grant-requests")
    .send(validGrantBody);
  const grantId = createRes.body.grant.id;

  const approveRes = await request(app)
    .post(`/grants/${grantId}/approve`)
    .send({});
  return { grantId, grant: approveRes.body };
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "aipassport-broker" });
  });
});

// ---------------------------------------------------------------------------
// POST /grant-requests
// ---------------------------------------------------------------------------

describe("POST /grant-requests", () => {
  it("creates a grant request and pending grant", async () => {
    const res = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);

    expect(res.status).toBe(201);
    expect(res.body.grantRequest).toBeDefined();
    expect(res.body.grantRequest.appName).toBe("TestApp");
    expect(res.body.grantRequest.id).toBeDefined();
    expect(res.body.grant).toBeDefined();
    expect(res.body.grant.status).toBe("pending");
    expect(res.body.grant.requestId).toBe(res.body.grantRequest.id);
  });

  it("returns 400 for missing appName", async () => {
    const res = await request(app)
      .post("/grant-requests")
      .send({ ...validGrantBody, appName: undefined });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 400 for invalid appUrl", async () => {
    const res = await request(app)
      .post("/grant-requests")
      .send({ ...validGrantBody, appUrl: "not-a-url" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid provider", async () => {
    const res = await request(app)
      .post("/grant-requests")
      .send({
        ...validGrantBody,
        scope: { ...validGrantBody.scope, provider: "invalid" },
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /grants/:id/approve
// ---------------------------------------------------------------------------

describe("POST /grants/:id/approve", () => {
  it("approves a pending grant", async () => {
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    const grantId = createRes.body.grant.id;

    const res = await request(app)
      .post(`/grants/${grantId}/approve`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedAt).toBeDefined();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts custom expiresInSeconds", async () => {
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    const grantId = createRes.body.grant.id;

    const before = Date.now();
    const res = await request(app)
      .post(`/grants/${grantId}/approve`)
      .send({ expiresInSeconds: 7200 });

    expect(res.status).toBe(200);
    const expiresMs = new Date(res.body.expiresAt).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 7200 * 1000 - 5000);
    expect(expiresMs).toBeLessThanOrEqual(before + 7200 * 1000 + 5000);
  });

  it("returns 400 for already-approved grant", async () => {
    const { grantId } = await createAndApproveGrant();

    const res = await request(app)
      .post(`/grants/${grantId}/approve`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved/);
  });

  it("returns 404 for nonexistent grant", async () => {
    const res = await request(app)
      .post("/grants/nonexistent-id/approve")
      .send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /grants/:id/deny
// ---------------------------------------------------------------------------

describe("POST /grants/:id/deny", () => {
  it("denies a pending grant", async () => {
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    const grantId = createRes.body.grant.id;

    const res = await request(app)
      .post(`/grants/${grantId}/deny`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("denied");
  });

  it("returns 400 for already-denied grant", async () => {
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    const grantId = createRes.body.grant.id;

    await request(app).post(`/grants/${grantId}/deny`).send({});
    const res = await request(app)
      .post(`/grants/${grantId}/deny`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/denied/);
  });

  it("returns 404 for nonexistent grant", async () => {
    const res = await request(app)
      .post("/grants/nonexistent-id/deny")
      .send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /grants/:id/revoke
// ---------------------------------------------------------------------------

describe("POST /grants/:id/revoke", () => {
  it("revokes an approved grant", async () => {
    const { grantId } = await createAndApproveGrant();

    const res = await request(app)
      .post(`/grants/${grantId}/revoke`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");
    expect(res.body.revokedAt).toBeDefined();
  });

  it("returns 404 for nonexistent grant", async () => {
    const res = await request(app)
      .post("/grants/nonexistent-id/revoke")
      .send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /grants
// ---------------------------------------------------------------------------

describe("GET /grants", () => {
  it("returns empty array when no grants exist", async () => {
    const res = await request(app).get("/grants");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all grants", async () => {
    await request(app).post("/grant-requests").send(validGrantBody);
    await request(app)
      .post("/grant-requests")
      .send({ ...validGrantBody, appName: "SecondApp" });

    const res = await request(app).get("/grants");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((g: any) => g.appName).sort();
    expect(names).toEqual(["SecondApp", "TestApp"]);
  });
});

// ---------------------------------------------------------------------------
// POST /tokens
// ---------------------------------------------------------------------------

describe("POST /tokens", () => {
  it("issues a JWT for an approved grant", async () => {
    const { grantId } = await createAndApproveGrant();

    const res = await request(app)
      .post("/tokens")
      .send({ grantId });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    // JWT has three dot-separated parts
    expect(res.body.token.split(".")).toHaveLength(3);
    expect(res.body.grantId).toBe(grantId);
    expect(res.body.expiresAt).toBeDefined();
  });

  it("returns 400 when grantId is missing", async () => {
    const res = await request(app).post("/tokens").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 400 when grantId is empty", async () => {
    const res = await request(app).post("/tokens").send({ grantId: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 400 for a pending grant", async () => {
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    const grantId = createRes.body.grant.id;

    const res = await request(app)
      .post("/tokens")
      .send({ grantId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending/);
  });

  it("returns 404 for nonexistent grant", async () => {
    const res = await request(app)
      .post("/tokens")
      .send({ grantId: "nonexistent-id" });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/chat
// ---------------------------------------------------------------------------

describe("POST /proxy/chat", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authorization/i);
  });

  it("returns 401 with malformed Authorization header", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", "Token abc123")
      .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", "Bearer invalid-jwt-token")
      .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
  });

  it("returns 400 when model is missing", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", "Bearer some-token")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 400 when messages is missing", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", "Bearer some-token")
      .send({ model: "gpt-4o" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 400 when messages have wrong shape", async () => {
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", "Bearer some-token")
      .send({ model: "gpt-4o", messages: [{ role: "user" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("returns 401 with token from revoked grant", async () => {
    const { grantId } = await createAndApproveGrant();

    // Get a valid token
    const tokenRes = await request(app)
      .post("/tokens")
      .send({ grantId });
    const token = tokenRes.body.token;

    // Revoke the grant
    await request(app).post(`/grants/${grantId}/revoke`).send({});

    // Try to use the token
    const res = await request(app)
      .post("/proxy/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: request → approve → token → revoke
// ---------------------------------------------------------------------------

describe("Full grant lifecycle", () => {
  it("completes request → approve → token → revoke", async () => {
    // 1. Create grant request
    const createRes = await request(app)
      .post("/grant-requests")
      .send(validGrantBody);
    expect(createRes.status).toBe(201);
    const grantId = createRes.body.grant.id;

    // 2. Verify it appears in the grants list as pending
    const listRes = await request(app).get("/grants");
    expect(listRes.body.find((g: any) => g.id === grantId).status).toBe("pending");

    // 3. Approve
    const approveRes = await request(app)
      .post(`/grants/${grantId}/approve`)
      .send({});
    expect(approveRes.body.status).toBe("approved");

    // 4. Issue token
    const tokenRes = await request(app)
      .post("/tokens")
      .send({ grantId });
    expect(tokenRes.status).toBe(201);
    expect(tokenRes.body.token.split(".")).toHaveLength(3);

    // 5. Revoke
    const revokeRes = await request(app)
      .post(`/grants/${grantId}/revoke`)
      .send({});
    expect(revokeRes.body.status).toBe("revoked");

    // 6. Token should now be invalid
    const proxyRes = await request(app)
      .post("/proxy/chat")
      .set("Authorization", `Bearer ${tokenRes.body.token}`)
      .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(proxyRes.status).toBe(401);
  });
});
