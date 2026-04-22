"use node";

/**
 * Manual IMAP scan entry point — thin wrapper around the emailScanPipeline.
 * Auth-checks the viewer, then fires startEmailScan and returns immediately.
 * All scan logic now lives in emailScanPipeline.ts.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";

export const scanInbox = action({
  args: {
    connectionId: v.id("emailConnections"),
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    senderDomains: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");

    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
    const orgId = orgData?.org?._id;

    // Save scan params for UI display
    const scanParams: Record<string, unknown> = {};
    if (args.sinceDate) scanParams.sinceDate = args.sinceDate;
    if (args.untilDate) scanParams.untilDate = args.untilDate;
    if (args.senderDomains?.length) scanParams.senderDomains = args.senderDomains;
    await ctx.runMutation(api.connections.updateLastScanParams, {
      id: args.connectionId,
      lastScanParams: scanParams,
    });

    // Fire-and-forget pipeline (runs async via scheduler)
    await ctx.runAction(internal.actions.emailScanPipeline.startEmailScan, {
      connectionId: args.connectionId,
      orgId,
      userId: viewer._id,
      trigger: "manual",
      sinceDate: args.sinceDate,
      untilDate: args.untilDate,
      senderDomains: args.senderDomains,
      mode: "full",
    });

    return { started: true };
  },
});
