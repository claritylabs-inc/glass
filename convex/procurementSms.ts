import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const eventType = v.union(
  v.literal("message.received"),
  v.literal("message.delivered"),
);

export const ingestQuoEvent = internalMutation({
  args: {
    providerEventId: v.string(),
    providerMessageId: v.string(),
    eventType,
    phoneNumberId: v.string(),
    conversationId: v.optional(v.string()),
    counterpartyPhone: v.string(),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    from: v.string(),
    to: v.array(v.string()),
    body: v.string(),
    status: v.optional(v.string()),
    contactIds: v.optional(v.array(v.string())),
    media: v.optional(
      v.array(
        v.object({
          url: v.string(),
          type: v.optional(v.string()),
        }),
      ),
    ),
    providerCreatedAt: v.string(),
    messageCreatedAt: v.optional(v.string()),
  },
  handler: async (ctx, event) => {
    const existing = await ctx.db
      .query("procurementSmsEvents")
      .withIndex("provider_event", (query) =>
        query.eq("providerEventId", event.providerEventId),
      )
      .unique();
    if (existing) return { duplicate: true, eventId: existing._id };

    const eventId = await ctx.db.insert("procurementSmsEvents", {
      ...event,
      receivedAt: dayjs().valueOf(),
    });
    return { duplicate: false, eventId };
  },
});
