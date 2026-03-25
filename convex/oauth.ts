import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/orgAuth";

// ── Helpers ──

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Internal functions (called by HTTP actions) ──

export const registerClient = internalMutation({
  args: {
    clientName: v.string(),
    redirectUris: v.array(v.string()),
    tokenEndpointAuthMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = crypto.randomUUID();
    await ctx.db.insert("oauthClients", {
      clientId,
      clientName: args.clientName,
      redirectUris: args.redirectUris,
      tokenEndpointAuthMethod: args.tokenEndpointAuthMethod ?? "none",
      createdAt: Date.now(),
    });
    return {
      client_id: clientId,
      client_name: args.clientName,
      redirect_uris: args.redirectUris,
      token_endpoint_auth_method: args.tokenEndpointAuthMethod ?? "none",
    };
  },
});

export const getClientByClientId = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("oauthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .first();
  },
});

export const exchangeAuthCode = internalMutation({
  args: {
    codeRaw: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeVerifier: v.string(),
  },
  handler: async (ctx, args) => {
    const codeHash = await sha256Hex(args.codeRaw);
    const codeRecord = await ctx.db
      .query("oauthAuthCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .first();

    if (!codeRecord) throw new Error("invalid_grant");
    if (codeRecord.usedAt) throw new Error("invalid_grant");
    if (codeRecord.expiresAt < Date.now()) throw new Error("invalid_grant");
    if (codeRecord.clientId !== args.clientId) throw new Error("invalid_grant");
    if (codeRecord.redirectUri !== args.redirectUri) throw new Error("invalid_grant");

    // PKCE S256 verification
    const encoder = new TextEncoder();
    const verifierBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(args.codeVerifier),
    );
    const computedChallenge = base64UrlEncode(verifierBuffer);
    if (computedChallenge !== codeRecord.codeChallenge) {
      throw new Error("invalid_grant");
    }

    // Mark code as used
    await ctx.db.patch(codeRecord._id, { usedAt: Date.now() });

    // Generate access + refresh tokens
    const accessTokenRaw = "prsm_at_" + randomHex(48);
    const refreshTokenRaw = "prsm_rt_" + randomHex(48);
    const tokenHash = await sha256Hex(accessTokenRaw);
    const refreshTokenHash = await sha256Hex(refreshTokenRaw);

    const now = Date.now();
    await ctx.db.insert("oauthTokens", {
      tokenHash,
      refreshTokenHash,
      clientId: args.clientId,
      userId: codeRecord.userId,
      orgId: codeRecord.orgId,
      scope: codeRecord.scope,
      expiresAt: now + 60 * 60 * 1000, // 1 hour
      refreshExpiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      createdAt: now,
    });

    return {
      access_token: accessTokenRaw,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshTokenRaw,
    };
  },
});

export const validateAccessToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("oauthTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();

    if (!token) return null;
    if (token.revokedAt) return null;
    if (token.expiresAt < Date.now()) return null;

    return {
      userId: token.userId,
      orgId: token.orgId,
      clientId: token.clientId,
    };
  },
});

export const refreshAccessToken = internalMutation({
  args: {
    refreshTokenRaw: v.string(),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const refreshHash = await sha256Hex(args.refreshTokenRaw);
    const token = await ctx.db
      .query("oauthTokens")
      .withIndex("by_refreshTokenHash", (q) =>
        q.eq("refreshTokenHash", refreshHash),
      )
      .first();

    if (!token) throw new Error("invalid_grant");
    if (token.revokedAt) throw new Error("invalid_grant");
    if (token.refreshExpiresAt && token.refreshExpiresAt < Date.now()) {
      throw new Error("invalid_grant");
    }
    if (token.clientId !== args.clientId) throw new Error("invalid_grant");

    // Revoke old token pair
    await ctx.db.patch(token._id, { revokedAt: Date.now() });

    // Issue new pair
    const accessTokenRaw = "prsm_at_" + randomHex(48);
    const refreshTokenRaw = "prsm_rt_" + randomHex(48);
    const tokenHash = await sha256Hex(accessTokenRaw);
    const refreshTokenHash = await sha256Hex(refreshTokenRaw);

    const now = Date.now();
    await ctx.db.insert("oauthTokens", {
      tokenHash,
      refreshTokenHash,
      clientId: args.clientId,
      userId: token.userId,
      orgId: token.orgId,
      scope: token.scope,
      expiresAt: now + 60 * 60 * 1000,
      refreshExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return {
      access_token: accessTokenRaw,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshTokenRaw,
    };
  },
});

export const revokeTokenInternal = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("oauthTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    if (token && !token.revokedAt) {
      await ctx.db.patch(token._id, { revokedAt: Date.now() });
    }
  },
});

// ── Public functions (called by authorize page) ──

export const getClientInfo = query({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    // Requires auth (Convex query context provides it)
    await requireOrgAccess(ctx);

    const client = await ctx.db
      .query("oauthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .first();

    if (!client) return null;

    // Validate redirect_uri is registered
    if (!client.redirectUris.includes(args.redirectUri)) return null;

    return {
      clientName: client.clientName,
      clientId: client.clientId,
    };
  },
});

export const createAuthorizationCode = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);

    // Verify client exists and redirect_uri matches
    const client = await ctx.db
      .query("oauthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .first();

    if (!client) throw new Error("Invalid client");
    if (!client.redirectUris.includes(args.redirectUri)) {
      throw new Error("Invalid redirect_uri");
    }

    const codeRaw = randomHex(32); // 64 hex chars
    const codeHash = await sha256Hex(codeRaw);

    await ctx.db.insert("oauthAuthCodes", {
      codeHash,
      clientId: args.clientId,
      userId,
      orgId,
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      scope: args.scope,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    return codeRaw;
  },
});

// ── Connected Apps (for settings page) ──

export const listConnectedApps = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireOrgAccess(ctx);

    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Group by clientId, show only active (non-revoked) tokens
    const activeByClient = new Map<
      string,
      { clientId: string; createdAt: number; expiresAt: number; tokenId: Id<"oauthTokens"> }
    >();

    for (const t of tokens) {
      if (t.revokedAt) continue;
      const existing = activeByClient.get(t.clientId);
      if (!existing || t.createdAt > existing.createdAt) {
        activeByClient.set(t.clientId, {
          clientId: t.clientId,
          createdAt: t.createdAt,
          expiresAt: t.expiresAt,
          tokenId: t._id,
        });
      }
    }

    // Resolve client names
    const apps = [];
    for (const [clientId, info] of activeByClient) {
      const client = await ctx.db
        .query("oauthClients")
        .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
        .first();
      apps.push({
        tokenId: info.tokenId,
        clientName: client?.clientName ?? "Unknown App",
        clientId,
        connectedAt: info.createdAt,
      });
    }

    return apps.sort((a, b) => b.connectedAt - a.connectedAt);
  },
});

export const revokeApp = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);

    // Revoke all tokens for this user + client
    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const now = Date.now();
    for (const t of tokens) {
      if (t.clientId === args.clientId && !t.revokedAt) {
        await ctx.db.patch(t._id, { revokedAt: now });
      }
    }
  },
});
