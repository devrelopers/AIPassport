import { Router } from "express";
import crypto from "node:crypto";
import { CreateGrantRequestSchema } from "../types/index.js";
import { validate } from "../middleware/validate.js";
import {
  addGrantRequest,
  createGrantFromRequest,
  getGrant,
  getAllGrants,
  revokeGrant,
  getDb,
} from "../store/index.js";

export function grantsRouter(): Router {
  const router = Router();

  // POST /grant-requests - Create a new grant request
  router.post(
    "/grant-requests",
    validate(CreateGrantRequestSchema),
    (req, res) => {
      const grantRequest = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...req.body,
      };

      addGrantRequest(grantRequest);

      // Auto-create a Grant in 'pending' status
      const grant = createGrantFromRequest(grantRequest.id, {
        requestId: grantRequest.id,
        approved: false,
      });

      // Override to pending (createGrantFromRequest sets denied for approved=false)
      const db = getDb();
      db.prepare(
        "UPDATE grants SET status = ?, expires_at = ? WHERE id = ?",
      ).run(
        "pending",
        new Date(Date.now() + 3600 * 1000).toISOString(),
        grant.id,
      );

      const updatedGrant = getGrant(grant.id)!;
      res.status(201).json({ grantRequest, grant: updatedGrant });
    },
  );

  // POST /grants/:id/approve - Approve a pending grant
  router.post("/grants/:id/approve", (req, res) => {
    const grant = getGrant(req.params.id);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    if (grant.status !== "pending") {
      res
        .status(400)
        .json({ error: `Grant is '${grant.status}', must be 'pending'` });
      return;
    }

    const expiresInSeconds =
      (req.body as { expiresInSeconds?: number }).expiresInSeconds ?? 3600;

    const db = getDb();
    db.prepare(
      "UPDATE grants SET status = ?, approved_at = ?, expires_at = ? WHERE id = ?",
    ).run(
      "approved",
      new Date().toISOString(),
      new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      req.params.id,
    );

    res.json(getGrant(req.params.id));
  });

  // POST /grants/:id/deny - Deny a pending grant
  router.post("/grants/:id/deny", (req, res) => {
    const grant = getGrant(req.params.id);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    if (grant.status !== "pending") {
      res
        .status(400)
        .json({ error: `Grant is '${grant.status}', must be 'pending'` });
      return;
    }

    const db = getDb();
    db.prepare("UPDATE grants SET status = ? WHERE id = ?").run(
      "denied",
      req.params.id,
    );

    res.json(getGrant(req.params.id));
  });

  // GET /grants - List all grants
  router.get("/grants", (_req, res) => {
    res.json(getAllGrants());
  });

  // GET /grants/:id - Get a single grant
  router.get("/grants/:id", (req, res) => {
    const grant = getGrant(req.params.id);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    res.json(grant);
  });

  // POST /grants/:id/revoke - Revoke an approved grant
  router.post("/grants/:id/revoke", (req, res) => {
    try {
      const grant = revokeGrant(req.params.id);
      res.json(grant);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}
