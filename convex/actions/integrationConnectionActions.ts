// convex/actions/integrationConnectionActions.ts
// Node.js actions for Merge API calls that require external network access.
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { getOrgAccess } from "../lib/access";
import {
  assertCanConnectIntegration,
  assertCanDisconnectIntegration,
} from "../lib/access";
import { getMergeClient } from "../lib/mergeClient";

/**
 * Returns a short-lived Merge Link token.
 * The client passes it to the Merge Link widget to begin OAuth.
 */
export const createLinkToken = action({
  args: {
    clientOrgId: v.id("organizations"),
    category: v.union(
      v.literal("accounting"),
      v.literal("hris"),
      v.literal("payroll"),
    ),
    originatingApplicationId: v.optional(v.id("applications")),
    integrationRequestId: v.optional(v.id("integrationRequests")),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx as any, args.clientOrgId);
    assertCanConnectIntegration(access);

    const client = getMergeClient();
    const result = await client.createLinkToken({
      endUserOriginId: args.clientOrgId,
      endUserOrganizationName: access.org.name,
      category: args.category,
    });

    return { linkToken: result.linkToken };
  },
});

/**
 * Public action: client user disconnects an integration.
 * Calls Merge delete, flips status, emits broker notification.
 */
export const disconnect = action({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    const conn = await ctx.runQuery(
      (internal as any).integrationConnections.getInternal,
      { connectionId: args.connectionId },
    );
    if (!conn) throw new Error("Connection not found");

    const access = await getOrgAccess(ctx as any, conn.clientOrgId);
    assertCanDisconnectIntegration(access);

    const mergeClient = getMergeClient();
    await mergeClient.deleteLinkedAccount(conn.mergeLinkedAccountId);

    await ctx.runMutation(
      (internal as any).integrationConnections.markDisconnectedByIdInternal,
      { connectionId: args.connectionId },
    );
  },
});
