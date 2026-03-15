// Security boundary: raw API keys are injected here at proxy time, never sent to the client.

import type { Grant, ProxyRequest } from "../types/index.js";
import { getProviderKey } from "../store/index.js";

/**
 * Proxies a request to the upstream AI provider on behalf of a validated grant.
 *
 * The relying app never sees or stores the real API key – it is injected here
 * at the last moment and only sent to the upstream provider.
 */
export async function proxyToProvider(
  grant: Grant,
  request: ProxyRequest,
): Promise<any> {
  // 1. Resolve the upstream API key
  const apiKey = getProviderKey(grant.scope.provider);
  if (!apiKey) {
    throw new Error(
      `No API key configured for provider '${grant.scope.provider}'. ` +
        `Set the corresponding environment variable.`,
    );
  }

  // 2. Model allowlist check
  if (grant.scope.models.length > 0 && !grant.scope.models.includes(request.model)) {
    throw new Error(
      `Model '${request.model}' is not permitted by this grant. ` +
        `Allowed models: ${grant.scope.models.join(", ")}`,
    );
  }

  // 3. Capability check
  if (!grant.scope.capabilities.includes("chat")) {
    throw new Error(
      `Capability 'chat' is not permitted by this grant. ` +
        `Allowed capabilities: ${grant.scope.capabilities.join(", ")}`,
    );
  }

  // 4. Dispatch to the appropriate provider
  const { provider } = grant.scope;

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
      }),
    });
    return response.json();
  }

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: 1024,
      }),
    });
    return response.json();
  }

  if (provider === "google") {
    // MVP: mock response for Google provider
    return {
      provider: "google",
      model: request.model,
      mock: true,
      message: "Google provider proxy is not yet implemented. This is a mock response.",
      choices: [
        {
          message: {
            role: "assistant",
            content: "This is a mock response from the Google provider.",
          },
        },
      ],
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
