"use node";

/**
 * Daily cron scan — thin wrapper around emailScanPipeline.
 * runDailyScan is the cron entry point; scanSingleConnection delegates
 * to startEmailScan for each connection. The heavy IMAP/Gmail logic
 * now lives entirely in emailScanPipeline.ts.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Cron entry point: queries all active email connections and schedules
 * individual scans for each one.
 */
export const runDailyScan = internalAction({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const connections: { _id: Id<"emailConnections">; lastScanStatus?: string; provider?: string }[] =
      await ctx.runQuery(internal.connections.listAllInternal);

    const active = connections.filter(
      (c) => c.lastScanStatus !== "disconnected" && c.provider !== "demo",
    );

    for (const connection of active) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.dailyScan.scanSingleConnection,
        { connectionId: connection._id },
      );
    }

    return { scheduled: active.length };
  },
});

/**
 * Per-connection daily scan — delegates to the email scan pipeline.
 */
export const scanSingleConnection = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.connections.getInternal, {
      id: args.connectionId,
    });
    if (!connection) return { error: "Connection not found" };

    await ctx.runAction(internal.actions.emailScanPipeline.startEmailScan, {
      connectionId: args.connectionId,
      orgId: connection.orgId,
      userId: connection.userId,
      trigger: "daily",
      mode: "full",
    });

    return { started: true };
  },
});
