// convex/integrationRequests.ts
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import {
  assertCanRequestIntegration,
  assertCanConnectIntegration,
} from "./lib/access";
import { notify } from "./lib/notify";

/** List pending requests visible to the client (for the banner). */
export const listForClient = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.clientOrgId);
    // member reads their own pending requests
    return ctx.db
      .query("integrationRequests")
      .withIndex("by_clientOrgId_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "pending"),
      )
      .collect();
  },
});

/** List requests the broker submitted. */
export const listForBroker = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.brokerOrgId);
    return ctx.db
      .query("integrationRequests")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.brokerOrgId))
      .order("desc")
      .take(50);
  },
});

/** Broker creates a nudge for the client. Emits integration_requested_by_broker notification. */
export const create = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    category: v.union(
      v.literal("accounting"),
      v.literal("hris"),
      v.literal("payroll"),
    ),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    assertCanRequestIntegration(access);

    const brokerOrgId = access.brokerOrgId!;
    const brokerOrg = await ctx.db.get(brokerOrgId);
    const now = Date.now();

    const requestId = await ctx.db.insert("integrationRequests", {
      brokerOrgId,
      clientOrgId: args.clientOrgId,
      category: args.category,
      requestedByUserId: access.userId,
      message: args.message,
      status: "pending",
      createdAt: now,
    });

    // Emit client-facing notification
    await notify(ctx, {
      orgId: args.clientOrgId,
      type: "integration_requested_by_broker",
      title: `${brokerOrg?.name ?? "Your broker"} requested an integration`,
      body: `${brokerOrg?.name ?? "Your broker"} asked you to connect your ${args.category} data${args.message ? `: "${args.message}"` : "."}`,
      relatedOrgId: brokerOrgId,
      actionType: "open_integrations_settings",
      actionPayload: { category: args.category, integrationRequestId: requestId },
    });

    return requestId;
  },
});

/** Client dismisses a broker nudge. */
export const dismiss = mutation({
  args: { requestId: v.id("integrationRequests") },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");
    const access = await getOrgAccess(ctx, req.clientOrgId);
    assertCanConnectIntegration(access); // member-only
    await ctx.db.patch(args.requestId, { status: "dismissed", resolvedAt: Date.now() });
  },
});

/** Internal: mark fulfilled when a connection is successfully established. */
export const markFulfilledInternal = mutation({
  args: { requestId: v.id("integrationRequests") },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req || req.status !== "pending") return;

    await ctx.db.patch(args.requestId, { status: "fulfilled", resolvedAt: Date.now() });

    // Notify broker that the request was fulfilled
    const clientOrg = await ctx.db.get(req.clientOrgId);
    await notify(ctx, {
      orgId: req.brokerOrgId,
      type: "integration_request_fulfilled",
      title: `Integration connected`,
      body: `${clientOrg?.name ?? "The client"} connected their ${req.category} data as requested.`,
      relatedOrgId: req.clientOrgId,
      actionType: "view_client_integrations",
      actionPayload: { clientOrgId: req.clientOrgId },
    });
  },
});
