"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { makeEmbedText } from "../lib/sdkCallbacks";

export const update = action({
  args: {
    id: v.id("documentChunks"),
    text: v.optional(v.string()),
    chunkType: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg);
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId;
    const chunk = await ctx.runQuery(internal.documentChunks.get, { id: args.id });
    if (!chunk || chunk.orgId !== orgId) {
      return { error: "Not found" };
    }

    const patch: {
      text?: string;
      chunkType?: string;
      embedding?: number[];
    } = {};

    if (args.text !== undefined) {
      const nextText = args.text.trim();
      patch.text = nextText;
      if (nextText !== chunk.text) {
        const embedText = makeEmbedText();
        patch.embedding = await embedText(nextText);
      }
    }

    if (args.chunkType !== undefined) {
      patch.chunkType = args.chunkType;
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true, updated: false };
    }

    await ctx.runMutation(internal.documentChunks.updateOne, {
      id: args.id,
      ...patch,
    });

    return { ok: true, updated: true };
  },
});
