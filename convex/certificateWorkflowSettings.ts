import dayjs from "dayjs";
import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireCurrentOrgAccess,
  requireCurrentOrgAdmin,
  type CurrentOrgAccess,
} from "./lib/access";

export const DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS = {
  populateHoldersFromEndorsements: true,
  renewalReissueEnabled: true,
  renewalReissueMode: "review_queue" as const,
  renewalReviewLeadDays: 60,
  policyChangeRequestsForHeldCertificatesEnabled: true,
  channels: ["email"] as Array<"email" | "imessage">,
  copyInstructions: undefined as string | undefined,
};

type ReadCtx = QueryCtx | MutationCtx;

const settingsArgs = {
  populateHoldersFromEndorsements: v.boolean(),
  renewalReissueEnabled: v.boolean(),
  renewalReviewLeadDays: v.optional(v.number()),
  policyChangeRequestsForHeldCertificatesEnabled: v.optional(v.boolean()),
  channels: v.optional(v.array(v.union(v.literal("email"), v.literal("imessage")))),
  copyInstructions: v.optional(v.string()),
};

function clampLeadDays(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReviewLeadDays;
  return Math.max(0, Math.min(365, Math.round(value as number)));
}

function cleanOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function valuesFromRow(row?: Doc<"certificateWorkflowSettings"> | null, legacyOrg?: Doc<"organizations"> | null) {
  return {
    populateHoldersFromEndorsements:
      row?.populateHoldersFromEndorsements ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.populateHoldersFromEndorsements,
    renewalReissueEnabled:
      row?.renewalReissueEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReissueEnabled,
    renewalReissueMode: "review_queue" as const,
    renewalReviewLeadDays:
      row?.renewalReviewLeadDays ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReviewLeadDays,
    policyChangeRequestsForHeldCertificatesEnabled:
      row?.policyChangeRequestsForHeldCertificatesEnabled ??
      legacyOrg?.certificateChangeRequestsEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.policyChangeRequestsForHeldCertificatesEnabled,
    channels: row?.channels ?? DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.channels,
    copyInstructions: row?.copyInstructions,
  };
}

async function getBrokerDefault(ctx: ReadCtx, brokerOrgId?: Id<"organizations"> | null) {
  if (!brokerOrgId) return null;
  return await ctx.db
    .query("certificateWorkflowSettings")
    .withIndex("by_brokerOrgId_clientOrgId", (q) =>
      q.eq("brokerOrgId", brokerOrgId).eq("clientOrgId", undefined),
    )
    .first();
}

async function getClientOverride(ctx: ReadCtx, clientOrgId?: Id<"organizations"> | null) {
  if (!clientOrgId) return null;
  return await ctx.db
    .query("certificateWorkflowSettings")
    .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
}

async function resolveEffectiveForOrg(ctx: ReadCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");
  const orgType = (org.type ?? "client") as "broker" | "client" | "partner";
  const clientOrgId = orgType === "client" ? orgId : null;
  const brokerOrgId = orgType === "broker"
    ? orgId
    : orgType === "client"
      ? (org.brokerOrgId ?? null)
      : null;

  const [brokerDefault, clientOverride] = await Promise.all([
    getBrokerDefault(ctx, brokerOrgId),
    getClientOverride(ctx, clientOrgId),
  ]);
  const row = clientOverride ?? brokerDefault ?? null;
  const source = clientOverride
    ? "client_override"
    : brokerDefault
      ? "broker_default"
      : "platform_default";
  const legacySettingsOrg = clientOverride
    ? org
    : brokerOrgId
      ? await ctx.db.get(brokerOrgId)
      : org;
  const values = valuesFromRow(row, legacySettingsOrg);
  return {
    ...values,
    policyChangeRequestsForHeldCertificatesEnabled:
      legacySettingsOrg?.policyChangeRequestsEnabled !== false &&
      values.policyChangeRequestsForHeldCertificatesEnabled,
    source,
    row,
    brokerDefault,
    clientOverride,
    brokerOrgId,
    clientOrgId,
  };
}

function assertBrokerAdmin(access: CurrentOrgAccess) {
  if ((access.org.type ?? "client") !== "broker") throw new Error("Broker organization required");
  if (access.role !== "admin") throw new Error("Broker admin access required");
}

function assertClientAdmin(access: CurrentOrgAccess) {
  if ((access.org.type ?? "client") !== "client") throw new Error("Client organization required");
  if (access.role !== "admin") throw new Error("Client admin access required");
}

export const getEffectiveForCurrentOrg = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentOrgAccess(ctx);
    return await resolveEffectiveForOrg(ctx, access.orgId);
  },
});

export const getEffectiveInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await resolveEffectiveForOrg(ctx, args.orgId);
  },
});

export const updateBrokerDefault = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdmin(ctx);
    assertBrokerAdmin(access);
    const now = dayjs().valueOf();
    const patch = {
      brokerOrgId: access.orgId,
      clientOrgId: undefined,
      populateHoldersFromEndorsements: args.populateHoldersFromEndorsements,
      renewalReissueEnabled: args.renewalReissueEnabled,
      renewalReissueMode: "review_queue" as const,
      renewalReviewLeadDays: clampLeadDays(args.renewalReviewLeadDays),
      policyChangeRequestsForHeldCertificatesEnabled: args.policyChangeRequestsForHeldCertificatesEnabled,
      channels: args.channels,
      copyInstructions: cleanOptional(args.copyInstructions),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const existing = await getBrokerDefault(ctx, access.orgId);
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("certificateWorkflowSettings", {
      ...patch,
      createdAt: now,
    });
  },
});

export const updateClientOverride = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdmin(ctx);
    assertClientAdmin(access);
    const now = dayjs().valueOf();
    const patch = {
      brokerOrgId: access.org.brokerOrgId,
      clientOrgId: access.orgId,
      populateHoldersFromEndorsements: args.populateHoldersFromEndorsements,
      renewalReissueEnabled: args.renewalReissueEnabled,
      renewalReissueMode: "review_queue" as const,
      renewalReviewLeadDays: clampLeadDays(args.renewalReviewLeadDays),
      policyChangeRequestsForHeldCertificatesEnabled: args.policyChangeRequestsForHeldCertificatesEnabled,
      channels: args.channels,
      copyInstructions: cleanOptional(args.copyInstructions),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const existing = await getClientOverride(ctx, access.orgId);
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("certificateWorkflowSettings", {
      ...patch,
      createdAt: now,
    });
  },
});

export const clearClientOverride = mutation({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentOrgAdmin(ctx);
    assertClientAdmin(access);
    const existing = await getClientOverride(ctx, access.orgId);
    if (existing) await ctx.db.delete(existing._id);
    return existing?._id ?? null;
  },
});
