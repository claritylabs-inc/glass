import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess, requireCurrentOrgAccess } from "./lib/access";
import {
  certificateHolderDedupeKey,
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderEmail,
  normalizeCertificateHolderName,
} from "./lib/certificateIdentity";
import { parseCertificateHolderCandidates } from "./lib/certificateHolderPopulation";

const addressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("extraction"),
  v.literal("certificate_generation"),
  v.literal("migration"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
);

const relationshipKindValidator = v.union(
  v.literal("additional_insured"),
  v.literal("loss_payee"),
  v.literal("mortgagee"),
  v.literal("allowed_holder"),
);

type ReadCtx = QueryCtx | MutationCtx;

function cleanOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function findExistingHolder(ctx: ReadCtx, args: {
  orgId: Id<"organizations">;
  normalizedName: string;
  normalizedEmail?: string;
  normalizedAddressKey?: string;
}) {
  if (args.normalizedEmail) {
    const byEmail = await ctx.db
      .query("certificateHolders")
      .withIndex("by_orgId_normalizedEmail", (q) =>
        q.eq("orgId", args.orgId).eq("normalizedEmail", args.normalizedEmail),
      )
      .first();
    if (byEmail) return byEmail;
  }

  const named = await ctx.db
    .query("certificateHolders")
    .withIndex("by_orgId_normalizedName", (q) =>
      q.eq("orgId", args.orgId).eq("normalizedName", args.normalizedName),
    )
    .collect();
  if (args.normalizedAddressKey) {
    return named.find((holder: Doc<"certificateHolders">) =>
      holder.normalizedAddressKey === args.normalizedAddressKey,
    ) ?? null;
  }
  return named.find((holder: Doc<"certificateHolders">) => !holder.normalizedAddressKey)
    ?? (named.length === 1 ? named[0] : null);
}

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.orgId);
    const holders = await ctx.db
      .query("certificateHolders")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const needle = normalizeCertificateHolderName(args.query ?? "");
    if (!needle) return holders.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return holders
      .filter((holder) =>
        holder.normalizedName.includes(needle)
        || holder.normalizedEmail?.includes(needle)
        || holder.normalizedAddressKey?.includes(needle),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const listForOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const holders = await ctx.db
      .query("certificateHolders")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const needle = normalizeCertificateHolderName(args.query ?? "");
    const filtered = needle
      ? holders.filter((holder) =>
          holder.normalizedName.includes(needle)
          || holder.normalizedEmail?.includes(needle)
          || holder.normalizedAddressKey?.includes(needle),
        )
      : holders;
    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const upsertForCurrentOrg = mutation({
  args: {
    displayName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressValidator),
    mapboxFeatureId: v.optional(v.string()),
    mapboxMetadata: v.optional(v.any()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireCurrentOrgAccess(ctx);
    return await upsertHolder(ctx, {
      ...args,
      orgId,
      source: "manual",
      createdByUserId: userId,
      updatedByUserId: userId,
    });
  },
});

async function upsertHolder(ctx: MutationCtx, args: {
  orgId: Id<"organizations">;
  displayName: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    formatted?: string;
  };
  mapboxFeatureId?: string;
  mapboxMetadata?: unknown;
  source: "manual" | "extraction" | "certificate_generation" | "migration" | "api" | "mcp" | "agent";
  sourceRef?: string;
  notes?: string;
  createdByUserId?: Id<"users">;
  updatedByUserId?: Id<"users">;
}) {
  const displayName = args.displayName.trim();
  if (!displayName) throw new Error("Certificate holder name is required.");
  const normalizedName = normalizeCertificateHolderName(displayName);
  const normalizedEmail = normalizeCertificateHolderEmail(args.email);
  const normalizedAddressKey = normalizeCertificateHolderAddress(args.address);
  const existing = await findExistingHolder(ctx, {
    orgId: args.orgId,
    normalizedName,
    normalizedEmail,
    normalizedAddressKey,
  });
  const now = dayjs().valueOf();
  const patch = {
    displayName,
    normalizedName,
    email: cleanOptional(args.email),
    normalizedEmail,
    phone: cleanOptional(args.phone),
    address: args.address,
    normalizedAddressKey,
    mapboxFeatureId: cleanOptional(args.mapboxFeatureId),
    mapboxMetadata: args.mapboxMetadata,
    source: args.source,
    sourceRef: args.sourceRef,
    notes: cleanOptional(args.notes),
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("certificateHolders", {
    orgId: args.orgId,
    ...patch,
    createdByUserId: args.createdByUserId,
    createdAt: now,
  });
}

export const upsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    displayName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressValidator),
    mapboxFeatureId: v.optional(v.string()),
    mapboxMetadata: v.optional(v.any()),
    source: sourceValidator,
    sourceRef: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await upsertHolder(ctx, args);
  },
});

export const linkPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    relationshipKind: relationshipKindValidator,
    status: v.optional(
      v.union(
        v.literal("current"),
        v.literal("historical"),
        v.literal("review_required"),
        v.literal("dismissed"),
      ),
    ),
    sourceNodeIds: v.optional(v.array(v.string())),
    sourceSpanIds: v.optional(v.array(v.string())),
    sourceSummary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await upsertPolicyLink(ctx, args);
  },
});

async function upsertPolicyLink(ctx: MutationCtx, args: {
  orgId: Id<"organizations">;
  holderId: Id<"certificateHolders">;
  policyId: Id<"policies">;
  policyVersionId?: Id<"policyVersions">;
  relationshipKind: "additional_insured" | "loss_payee" | "mortgagee" | "allowed_holder";
  status?: "current" | "historical" | "review_required" | "dismissed";
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  sourceSummary?: string;
  createdByUserId?: Id<"users">;
  updatedByUserId?: Id<"users">;
}) {
  const existing = await ctx.db
    .query("certificateHolderPolicyLinks")
    .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
    .collect();
  const match = existing.find((link) =>
    link.holderId === args.holderId
    && link.relationshipKind === args.relationshipKind
    && link.policyVersionId === args.policyVersionId,
  );
  const now = dayjs().valueOf();
  const patch = {
    status: args.status ?? "current",
    sourceNodeIds: args.sourceNodeIds,
    sourceSpanIds: args.sourceSpanIds,
    sourceSummary: args.sourceSummary,
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
  };
  if (match) {
    await ctx.db.patch(match._id, patch);
    return match._id;
  }
  return await ctx.db.insert("certificateHolderPolicyLinks", {
    orgId: args.orgId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    relationshipKind: args.relationshipKind,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    ...patch,
  });
}

export const populateForPolicyInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId || policy.deletedAt || policy.documentType === "quote") {
      return { holderCount: 0, linkCount: 0 };
    }

    const policyVersionId = policy.currentPolicyVersionId;
    const candidates = parseCertificateHolderCandidates({
      operationalProfile: policy.operationalProfile,
      policy,
    });
    let holderCount = 0;
    let linkCount = 0;
    for (const candidate of candidates) {
      const holderId = await upsertHolder(ctx, {
        orgId: policy.orgId,
        displayName: candidate.displayName,
        email: candidate.email,
        phone: candidate.phone,
        address: candidate.address,
        mapboxMetadata: candidate.mapboxMetadata,
        source: "extraction",
        sourceRef: String(args.policyId),
      });
      holderCount += 1;
      await upsertPolicyLink(ctx, {
        orgId: policy.orgId,
        holderId,
        policyId: args.policyId,
        policyVersionId,
        relationshipKind: candidate.relationshipKind,
        status: "current",
        sourceNodeIds: candidate.sourceNodeIds,
        sourceSpanIds: candidate.sourceSpanIds,
        sourceSummary: candidate.sourceSummary,
      });
      linkCount += 1;
    }
    return { holderCount, linkCount };
  },
});

export const getInternal = internalQuery({
  args: { holderId: v.id("certificateHolders") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.holderId);
  },
});

export const legacyDedupeKey = internalQuery({
  args: {
    orgId: v.id("organizations"),
    displayName: v.string(),
    email: v.optional(v.string()),
    address: v.optional(addressValidator),
  },
  handler: async (_ctx, args) => {
    const normalizedEmail = normalizeCertificateHolderEmail(args.email);
    const normalizedAddressKey = normalizeCertificateHolderAddress(args.address);
    return certificateHolderDedupeKey({
      orgId: String(args.orgId),
      displayName: args.displayName,
      normalizedAddressKey,
      normalizedEmail,
    });
  },
});
