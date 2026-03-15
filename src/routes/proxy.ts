import { Router } from "express";
import { ProxyRequestSchema } from "../types/index.js";
import { validate } from "../middleware/validate.js";
import { validateToken, incrementUsage } from "../store/index.js";
import { proxyToProvider } from "../lib/proxy.js";

export function proxyRouter(): Router {
  const router = Router();

  // POST /proxy/chat - Proxy a chat request to the upstream AI provider.
  // This endpoint is provider-agnostic: the target provider (OpenAI, Anthropic,
  // Google, etc.) is determined by the grant's scope, not by the URL path.
  // There are no per-provider proxy routes like /proxy/anthropic or /proxy/openai.
  router.post("/proxy/chat", validate(ProxyRequestSchema), async (req, res) => {
    // Extract bearer token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or malformed Authorization header" });
      return;
    }

    const tokenString = authHeader.slice("Bearer ".length);

    // Validate the token
    const result = await validateToken(tokenString);
    if (!result.valid) {
      res.status(401).json({ error: result.reason });
      return;
    }

    const { grant } = result;

    // Check usage caps
    const allowed = incrementUsage(grant.id);
    if (!allowed) {
      res.status(429).json({ error: "Usage cap exceeded" });
      return;
    }

    // Proxy request to the upstream provider
    try {
      const upstream = await proxyToProvider(grant, req.body);
      res.json(upstream);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
