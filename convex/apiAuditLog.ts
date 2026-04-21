import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const auditWrite = internalMutation({
  args: {
    requestId: v.string(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
    method: v.string(),
    path: v.string(),
    status: v.number(),
    body: v.optional(v.string()),
    response: v.optional(v.string()),
    tokenId: v.id("oauthTokens"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiAuditLog", {
      requestId: args.requestId,
      timestamp: Date.now(),
      userId: args.userId,
      orgId: args.orgId,
      method: args.method,
      path: args.path,
      status: args.status,
      body: args.body,
      response: args.response,
      tokenId: args.tokenId,
    });
  },
});
