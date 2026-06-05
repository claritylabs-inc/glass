import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";
import {
  parseCertificateHolderCandidates,
  type CertificateHolderCandidate,
  type CertificateHolderRelationshipKind,
} from "./lib/certificateHolderPopulation";

const addressValidator = v.object({
  formatted: v.optional(v.string()),
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
});

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.orgId);
    const holders = await ctx.db
      .query("certificateHolders")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return holders.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const listLinksByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) return [];
    await getOrgAccess(ctx, policy.orgId);
    const links = await ctx.db
      .query("certificateHolderPolicyLinks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    const rows = [];
    for (const link of links) {
      const holder = await ctx.db.get(link.holderId);
      rows.push({ ...link, holder });
    }
    return rows;
  },
});

export const listByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("certificateHolders")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const populateForPolicyInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId || policy.deletedAt || policy.documentType === "quote") {
      return { holderCount: 0, linkCount: 0 };
    }

    const candidates = parseCertificateHolderCandidates({
      operationalProfile: policy.operationalProfile,
      policy,
    });
    let holderCount = 0;
    let linkCount = 0;
    for (const candidate of candidates) {
      const holderId = await upsertHolder(ctx, policy.orgId, candidate);
      holderCount += 1;
      await upsertLink(ctx, {
        orgId: policy.orgId,
        holderId,
        policyId: args.policyId,
        candidate,
      });
      linkCount += 1;
    }
    return { holderCount, linkCount };
  },
});

export const upsertManualInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    displayName: v.string(),
    normalizedName: v.string(),
    address: v.optional(addressValidator),
    normalizedAddress: v.string(),
    email: v.optional(v.string()),
    normalizedEmail: v.string(),
    phone: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    mapbox: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await findHolder(ctx, args.orgId, {
      normalizedName: args.normalizedName,
      normalizedAddress: args.normalizedAddress,
      normalizedEmail: args.normalizedEmail,
    });
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        address: args.address,
        normalizedAddress: args.normalizedAddress,
        email: args.email,
        normalizedEmail: args.normalizedEmail,
        phone: args.phone,
        normalizedPhone: args.normalizedPhone,
        mapbox: args.mapbox,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("certificateHolders", {
      orgId: args.orgId,
      displayName: args.displayName,
      normalizedName: args.normalizedName,
      address: args.address,
      normalizedAddress: args.normalizedAddress,
      email: args.email,
      normalizedEmail: args.normalizedEmail,
      phone: args.phone,
      normalizedPhone: args.normalizedPhone,
      mapbox: args.mapbox,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function upsertHolder(
  ctx: any,
  orgId: Id<"organizations">,
  candidate: CertificateHolderCandidate,
) {
  const now = dayjs().valueOf();
  const existing = await findHolder(ctx, orgId, candidate);
  if (existing) {
    await ctx.db.patch(existing._id, {
      displayName: existing.displayName || candidate.name,
      address: existing.address ?? candidate.address,
      email: existing.email ?? candidate.email,
      normalizedEmail: existing.normalizedEmail || candidate.normalizedEmail,
      phone: existing.phone ?? candidate.phone,
      normalizedPhone: existing.normalizedPhone ?? candidate.normalizedPhone,
      mapbox: existing.mapbox ?? candidate.mapbox,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("certificateHolders", {
    orgId,
    displayName: candidate.name,
    normalizedName: candidate.normalizedName,
    address: candidate.address,
    normalizedAddress: candidate.normalizedAddress,
    email: candidate.email,
    normalizedEmail: candidate.normalizedEmail,
    phone: candidate.phone,
    normalizedPhone: candidate.normalizedPhone,
    mapbox: candidate.mapbox,
    source: "policy_extraction",
    createdAt: now,
    updatedAt: now,
  });
}

async function findHolder(
  ctx: any,
  orgId: Id<"organizations">,
  identity: { normalizedName: string; normalizedAddress: string; normalizedEmail: string },
) {
  return await ctx.db
    .query("certificateHolders")
    .withIndex("by_org_normalized_identity", (q: any) => q
      .eq("orgId", orgId)
      .eq("normalizedName", identity.normalizedName)
      .eq("normalizedAddress", identity.normalizedAddress)
      .eq("normalizedEmail", identity.normalizedEmail))
    .first();
}

async function upsertLink(
  ctx: any,
  args: {
    orgId: Id<"organizations">;
    holderId: Id<"certificateHolders">;
    policyId: Id<"policies">;
    candidate: CertificateHolderCandidate;
  },
) {
  const now = dayjs().valueOf();
  const existing = await ctx.db
    .query("certificateHolderPolicyLinks")
    .withIndex("by_holder_policy_kind", (q: any) => q
      .eq("holderId", args.holderId)
      .eq("policyId", args.policyId)
      .eq("relationshipKind", args.candidate.relationshipKind as CertificateHolderRelationshipKind))
    .first();
  const fields = {
    orgId: args.orgId,
    holderId: args.holderId,
    policyId: args.policyId,
    relationshipKind: args.candidate.relationshipKind,
    status: "active" as const,
    sourceNodeIds: args.candidate.sourceNodeIds,
    sourceSpanIds: args.candidate.sourceSpanIds,
    sourceSummary: args.candidate.sourceSummary,
    sourceProfilePath: args.candidate.sourceProfilePath,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }
  return await ctx.db.insert("certificateHolderPolicyLinks", {
    ...fields,
    createdAt: now,
  });
}

