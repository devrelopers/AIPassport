import { Router } from "express";
import crypto from "node:crypto";
import { CreateGrantRequestSchema } from "../types/index.js";
import { validate } from "../middleware/validate.js";
import {
  addGrantRequest,
  createPendingGrant,
  approveGrant,
  denyGrant,
  getGrant,
  getAllGrants,
  revokeGrant,
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
      const grant = createPendingGrant(grantRequest.id);

      res.status(201).json({ grantRequest, grant });
    },
  );

  // POST /grants/:id/approve - Approve a pending grant
  router.post("/grants/:id/approve", (req, res) => {
    const expiresInSeconds =
      (req.body as { expiresInSeconds?: number }).expiresInSeconds;

    try {
      const grant = approveGrant(req.params.id, expiresInSeconds);
      res.json(grant);
    } catch (err: any) {
      const message: string = err.message;
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
      } else {
        res.status(400).json({ error: message });
      }
    }
  });

  // POST /grants/:id/deny - Deny a pending grant
  router.post("/grants/:id/deny", (req, res) => {
    try {
      const grant = denyGrant(req.params.id);
      res.json(grant);
    } catch (err: any) {
      const message: string = err.message;
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
      } else {
        res.status(400).json({ error: message });
      }
    }
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
