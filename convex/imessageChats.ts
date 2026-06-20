import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const participantValidator = v.object({
  address: v.string(),
  displayName: v.optional(v.string()),
  userId: v.optional(v.id("users")),
  orgId: v.optional(v.id("organizations")),
  role: v.union(v.literal("linked"), v.literal("anonymous")),
});

export const syncChat = internalMutation({
  args: {
    chatGuid: v.string(),
    isGroup: v.boolean(),
    primaryOrgId: v.optional(v.id("organizations")),
    title: v.optional(v.string()),
    participants: v.array(participantValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("imessageChats")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", args.chatGuid))
      .first();

    if (existing) {
      const status =
        existing.status === "left" && args.isGroup && !args.primaryOrgId
          ? "left"
          : "active";
      await ctx.db.patch(existing._id, {
        isGroup: args.isGroup,
        status,
        primaryOrgId: args.primaryOrgId,
        title: args.title,
        participantCount: args.participants.length,
        lastParticipantSyncAt: now,
        lastMessageAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("imessageChats", {
        chatGuid: args.chatGuid,
        isGroup: args.isGroup,
        status: "active",
        primaryOrgId: args.primaryOrgId,
        title: args.title,
        participantCount: args.participants.length,
        lastParticipantSyncAt: now,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const participant of args.participants) {
      const existingParticipant = await ctx.db
        .query("imessageParticipants")
        .withIndex("by_chatGuid_address", (q) =>
          q.eq("chatGuid", args.chatGuid).eq("address", participant.address),
        )
        .first();

      if (existingParticipant) {
        await ctx.db.patch(existingParticipant._id, {
          displayName: participant.displayName,
          userId: participant.userId,
          orgId: participant.orgId,
          role: participant.role,
          lastSeenAt: now,
        });
      } else {
        await ctx.db.insert("imessageParticipants", {
          chatGuid: args.chatGuid,
          address: participant.address,
          displayName: participant.displayName,
          userId: participant.userId,
          orgId: participant.orgId,
          role: participant.role,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }
  },
});

export const markLeft = internalMutation({
  args: { chatGuid: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageChats")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", args.chatGuid))
      .first();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "left",
      updatedAt: Date.now(),
    });
  },
});
