import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  getOperatorSlackConfig,
  isApprovedOperatorSlackChannel,
} from "./lib/operatorSlackConfig";

async function ignoreEvent(
  event: Doc<"slackInboundEvents">,
  ctx: MutationCtx,
) {
  await ctx.db.patch(event._id, {
    status: "ignored",
    content: "",
    attachment: undefined,
    attachments: undefined,
    updatedAt: dayjs().valueOf(),
  });
}

export const ignoreEvents = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")) },
  handler: async (ctx, args) => {
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      if (event?.status === "processing" && !event.connectionId) {
        await ignoreEvent(event, ctx);
      }
    }
  },
});

export const authorizeBatch = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")) },
  handler: async (ctx, args) => {
    const config = getOperatorSlackConfig();
    const authorized: Array<{
      event: Doc<"slackInboundEvents">;
      operatorUserId: Doc<"operatorProfiles">["userId"];
    }> = [];
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      const directMessage = event?.isDirectMessage === true;
      const approvedChannel = Boolean(
        event && isApprovedOperatorSlackChannel(event.channelId),
      );
      if (
        !event ||
        event.status !== "processing" ||
        event.connectionId ||
        !config.enabled ||
        !config.hostTeamId ||
        event.teamId !== config.hostTeamId ||
        event.senderTeamId !== config.hostTeamId ||
        event.senderIsBot !== false ||
        event.eventType !== "message" ||
        (!directMessage && (!approvedChannel || !event.mentionsSpot))
      ) {
        if (event?.status === "processing" && !event.connectionId) {
          await ignoreEvent(event, ctx);
        }
        continue;
      }
      const operator = await ctx.db
        .query("operatorProfiles")
        .withIndex("slack_user", (q) =>
          q
            .eq("slackTeamId", event.senderTeamId)
            .eq("slackUserId", event.senderUserId),
        )
        .first();
      if (!operator || operator.status !== "active") {
        await ignoreEvent(event, ctx);
        continue;
      }
      authorized.push({ event, operatorUserId: operator.userId });
    }
    return authorized;
  },
});

export const completeEvent = internalMutation({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (event?.status === "processing" && !event.connectionId) {
      await ctx.db.patch(event._id, {
        status: "completed",
        updatedAt: dayjs().valueOf(),
      });
    }
  },
});
