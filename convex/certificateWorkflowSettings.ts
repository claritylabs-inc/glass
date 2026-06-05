import dayjs from "dayjs";
import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  requireCurrentOrgAccess,
  requireCurrentOrgAdmin,
  type CurrentOrgAccess,
} from "./lib/access";

export const DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS = {
  sourceBackedHolderPopulationEnabled: true,
  renewalReviewJobsEnabled: true,
  renewalReviewLeadDays: 60,
  policyChangeRequestsForHeldCertificatesEnabled: true,
};

type CertificateWorkflowSettingsDoc = Doc<"certificateWorkflowSettings">;

type CertificateWorkflowSettingsValues = typeof DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS;

type EffectiveCertificateWorkflowSettings = CertificateWorkflowSettingsValues & {
  source: "client_override" | "broker_default" | "platform_default";
  row: CertificateWorkflowSettingsDoc | null;
  brokerDefault: CertificateWorkflowSettingsDoc | null;
  clientOverride: CertificateWorkflowSettingsDoc | null;
  clientOrgId: Id<"organizations"> | null;
  brokerOrgId: Id<"organizations"> | null;
};

const updateArgs = {
  sourceBackedHolderPopulationEnabled: v.boolean(),
  renewalReviewJobsEnabled: v.boolean(),
  renewalReviewLeadDays: v.number(),
  policyChangeRequestsForHeldCertificatesEnabled: v.boolean(),
};

function clampLeadDays(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReviewLeadDays;
  return Math.max(0, Math.min(365, Math.round(value)));
}

function valuesFromRow(
  row: CertificateWorkflowSettingsDoc | null | undefined,
  legacySettingsOrg?: Doc<"organizations"> | null,
): CertificateWorkflowSettingsValues {
  return {
    sourceBackedHolderPopulationEnabled:
      row?.sourceBackedHolderPopulationEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.sourceBackedHolderPopulationEnabled,
    renewalReviewJobsEnabled:
      row?.renewalReviewJobsEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReviewJobsEnabled,
    renewalReviewLeadDays:
      row?.renewalReviewLeadDays ?? DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReviewLeadDays,
    policyChangeRequestsForHeldCertificatesEnabled:
      row?.policyChangeRequestsForHeldCertificatesEnabled ??
      legacySettingsOrg?.certificateChangeRequestsEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.policyChangeRequestsForHeldCertificatesEnabled,
  };
}

async function getBrokerDefault(
  ctx: QueryCtx | MutationCtx,
  brokerOrgId: Id<"organizations"> | null | undefined,
) {
  if (!brokerOrgId) return null;
  return await ctx.db
    .query("certificateWorkflowSettings")
    .withIndex("by_brokerOrgId_clientOrgId", (q) =>
      q.eq("brokerOrgId", brokerOrgId).eq("clientOrgId", undefined),
    )
    .first();
}

async function getClientOverride(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations"> | null | undefined,
) {
  if (!clientOrgId) return null;
  return await ctx.db
    .query("certificateWorkflowSettings")
    .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
}

async function resolveEffectiveForOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
): Promise<EffectiveCertificateWorkflowSettings> {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");

  const orgType = (org.type ?? "client") as "broker" | "client" | "partner";
  const clientOrgId = orgType === "client" ? orgId : null;
  const brokerOrgId = orgType === "broker" ? orgId : orgType === "client" ? (org.brokerOrgId ?? null) : null;

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
  const legacySettingsOrg = clientOverride ? org : brokerOrgId ? await ctx.db.get(brokerOrgId) : org;
  const values = valuesFromRow(row, legacySettingsOrg);
  const policyChangeRequestsEnabled =
    legacySettingsOrg?.policyChangeRequestsEnabled !== false &&
    values.policyChangeRequestsForHeldCertificatesEnabled;

  return {
    ...values,
    policyChangeRequestsForHeldCertificatesEnabled: policyChangeRequestsEnabled,
    source,
    row,
    brokerDefault,
    clientOverride,
    clientOrgId,
    brokerOrgId,
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
  args: updateArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdmin(ctx);
    assertBrokerAdmin(access);
    const now = dayjs().valueOf();
    const patch = {
      scope: "broker_default" as const,
      ownerOrgId: access.orgId,
      brokerOrgId: access.orgId,
      sourceBackedHolderPopulationEnabled: args.sourceBackedHolderPopulationEnabled,
      renewalReviewJobsEnabled: args.renewalReviewJobsEnabled,
      renewalReviewLeadDays: clampLeadDays(args.renewalReviewLeadDays),
      policyChangeRequestsForHeldCertificatesEnabled:
        args.policyChangeRequestsForHeldCertificatesEnabled,
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
  args: updateArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdmin(ctx);
    assertClientAdmin(access);
    const now = dayjs().valueOf();
    const patch = {
      scope: "client_override" as const,
      ownerOrgId: access.orgId,
      ...(access.org.brokerOrgId ? { brokerOrgId: access.org.brokerOrgId } : {}),
      clientOrgId: access.orgId,
      sourceBackedHolderPopulationEnabled: args.sourceBackedHolderPopulationEnabled,
      renewalReviewJobsEnabled: args.renewalReviewJobsEnabled,
      renewalReviewLeadDays: clampLeadDays(args.renewalReviewLeadDays),
      policyChangeRequestsForHeldCertificatesEnabled:
        args.policyChangeRequestsForHeldCertificatesEnabled,
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
