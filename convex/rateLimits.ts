import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const WINDOW_MS = 60_000;
const BURST_LIMIT = 600;
const SUSTAINED_PER_SEC = 20;
const MIN_MS_PER_REQUEST = Math.ceil(1000 / SUSTAINED_PER_SEC); // 50ms

export const checkRateLimit = internalMutation({
  args: { tokenId: v.id("oauthTokens") },
  handler: async (ctx, { tokenId }) => {
    const counter = await ctx.db
      .query("rateLimitCounters")
      .withIndex("token", (q) => q.eq("tokenId", tokenId))
      .first();

    const now = Date.now();
    const isNewWindow = !counter || now - counter.windowStart > WINDOW_MS;

    if (isNewWindow) {
      if (counter) {
        await ctx.db.delete(counter._id);
      }
      await ctx.db.insert("rateLimitCounters", {
        tokenId,
        windowStart: now,
        count: 1,
        lastRequestMs: 0,
      });
      return { allowed: true };
    }

    const msSinceLast = now - counter.windowStart - counter.lastRequestMs;
    if (msSinceLast < MIN_MS_PER_REQUEST) {
      return { allowed: false, reason: "sustained" as const };
    }

    if (counter.count >= BURST_LIMIT) {
      return { allowed: false, reason: "burst" as const };
    }

    await ctx.db.patch(counter._id, {
      count: counter.count + 1,
      lastRequestMs: counter.lastRequestMs + msSinceLast,
    });

    return { allowed: true };
  },
});
