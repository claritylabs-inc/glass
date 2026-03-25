import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

export type ApiKeyIdentity = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  keyId: Id<"apiKeys">;
};

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validate API key from Authorization header.
 * Returns the identity or throws an HTTP Response error.
 *
 * Note: This helper is for use in httpAction handlers (Convex runtime).
 * Uses Web Crypto API (no Node.js crypto).
 */
export async function requireApiKey(
  ctx: { runQuery: ActionCtx["runQuery"]; runMutation: ActionCtx["runMutation"] },
  request: Request,
): Promise<ApiKeyIdentity> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response("Missing or invalid Authorization header", {
      status: 401,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith("prism_")) {
    throw new Response("Invalid API key format", {
      status: 401,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const keyHash = await sha256Hex(rawKey);
  const result = await ctx.runQuery(internal.apiKeys.validateKey, { keyHash });

  if (!result) {
    throw new Response("Invalid or revoked API key", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Update last used timestamp
  await ctx.runMutation(internal.apiKeys.touchLastUsed, { id: result.keyId });

  return result;
}
