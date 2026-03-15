import { Router } from "express";
import {
  getGrant,
  issueToken,
  validateToken,
} from "../store/index.js";

export function tokensRouter(): Router {
  const router = Router();

  // POST /tokens - Issue a delegated token
  router.post("/tokens", async (req, res) => {
    const { grantId } = req.body as { grantId?: string };
    if (!grantId) {
      res.status(400).json({ error: "grantId is required" });
      return;
    }

    const grant = getGrant(grantId);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    if (grant.status !== "approved") {
      res
        .status(400)
        .json({ error: `Grant is '${grant.status}', must be 'approved'` });
      return;
    }
    if (new Date(grant.expiresAt) <= new Date()) {
      res.status(400).json({ error: "Grant has expired" });
      return;
    }

    const token = await issueToken(grantId);

    // Return token info but never expose the provider key
    res.status(201).json({
      token: token.token,
      grantId: token.grantId,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    });
  });

  // GET /tokens/:token/inspect - Inspect a token (for debugging)
  router.get("/tokens/:token/inspect", async (req, res) => {
    const result = await validateToken(req.params.token);

    if (!result.valid) {
      res.json({ valid: false, reason: result.reason });
      return;
    }

    const { grant } = result;
    res.json({
      valid: true,
      grant: {
        id: grant.id,
        appName: grant.appName,
        appUrl: grant.appUrl,
        scope: grant.scope,
        status: grant.status,
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
        usageCount: grant.usageCount,
      },
    });
  });

  return router;
}
