// convex/integrationData.ts
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import { assertCanReadRawIntegrationData } from "./lib/access";

/** Internal upsert: replaces existing row keyed by (clientOrgId, metricKey, period.kind, period.end). */
export const upsertMetric = internalMutation({
  args: {
    connectionId: v.id("integrationConnections"),
    clientOrgId: v.id("organizations"),
    metricKey: v.string(),
    value: v.any(),
    unit: v.optional(v.string()),
    asOfDate: v.optional(v.string()),
    period: v.optional(v.object({
      start: v.string(),
      end: v.string(),
      kind: v.union(
        v.literal("ytd"), v.literal("trailing_12"), v.literal("fiscal_year"),
        v.literal("calendar_year"), v.literal("quarter"), v.literal("month"),
      ),
    })),
    mergeSourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const syncedAt = Date.now();

    // Find existing row matching the upsert key
    const candidates = await ctx.db
      .query("integrationData")
      .withIndex("by_clientOrgId_metricKey", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("metricKey", args.metricKey),
      )
      .collect();

    const existing = candidates.find((r) => {
      if (!args.period && !r.period) return true;
      if (!args.period || !r.period) return false;
      return r.period.kind === args.period.kind && r.period.end === args.period.end;
    });

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        unit: args.unit,
        asOfDate: args.asOfDate,
        period: args.period,
        syncedAt,
        mergeSourceRef: args.mergeSourceRef,
        connectionId: args.connectionId,
      });
      return existing._id;
    }

    return await ctx.db.insert("integrationData", {
      connectionId: args.connectionId,
      clientOrgId: args.clientOrgId,
      metricKey: args.metricKey,
      value: args.value,
      unit: args.unit,
      asOfDate: args.asOfDate,
      period: args.period,
      syncedAt,
      mergeSourceRef: args.mergeSourceRef,
    });
  },
});

/** Internal: get the most recently synced metric row (or period-matched). */
export const getMetricInternal = internalQuery({
  args: {
    clientOrgId: v.id("organizations"),
    metricKey: v.string(),
    periodKind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("integrationData")
      .withIndex("by_clientOrgId_metricKey", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("metricKey", args.metricKey),
      )
      .order("desc")
      .collect();

    if (!args.periodKind) return rows[0] ?? null;
    return rows.find((r) => r.period?.kind === args.periodKind) ?? null;
  },
});

/** Public query: member-only read of a specific metric. */
export const getMetricForClient = query({
  args: {
    clientOrgId: v.id("organizations"),
    metricKey: v.string(),
    periodKind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    assertCanReadRawIntegrationData(access);

    const rows = await ctx.db
      .query("integrationData")
      .withIndex("by_clientOrgId_metricKey", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("metricKey", args.metricKey),
      )
      .order("desc")
      .collect();

    if (!args.periodKind) return rows[0] ?? null;
    return rows.find((r) => r.period?.kind === args.periodKind) ?? null;
  },
});

/** Internal: delete all data rows for a connection (used on disconnect cleanup). */
export const deleteByConnectionInternal = internalMutation({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("integrationData")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
  },
});
