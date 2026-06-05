import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";

const policyVersionEventValidator = v.union(
  v.literal("initial_extraction"),
  v.literal("re_extraction"),
  v.literal("policy_change"),
  v.literal("renewal"),
);

type PolicyVersionEvent =
  | "initial_extraction"
  | "re_extraction"
  | "policy_change"
  | "renewal";

type PolicySnapshot = Record<string, unknown>;

const CERTIFICATE_VISIBLE_POLICY_FIELDS = [
  "orgId",
  "documentType",
  "carrier",
  "security",
  "underwriter",
  "mga",
  "broker",
  "carrierLegalName",
  "carrierNaicNumber",
  "carrierAmBestRating",
  "carrierAdmittedStatus",
  "insurer",
  "producer",
  "brokerAgency",
  "brokerContactName",
  "brokerLicenseNumber",
  "partnerOrgId",
  "partnerProgramId",
  "partnerMatchSource",
  "policyNumber",
  "priorPolicyNumber",
  "programName",
  "policyTypes",
  "policyYear",
  "policyTermType",
  "effectiveDate",
  "expirationDate",
  "effectiveTime",
  "retroactiveDate",
  "nextReviewDate",
  "isRenewal",
  "insuredName",
  "insuredDba",
  "insuredAddress",
  "insuredEntityType",
  "insuredFein",
  "additionalNamedInsureds",
  "lossPayees",
  "mortgageHolders",
  "coverageForm",
  "limits",
  "deductibles",
  "coverages",
  "locations",
  "vehicles",
  "classifications",
  "formInventory",
  "premium",
  "premiumAmount",
  "totalCost",
  "totalCostAmount",
  "minPremium",
  "minPremiumAmount",
  "depositPremium",
  "depositPremiumAmount",
  "auditProvision",
  "cancellationProvisions",
  "nonRenewalProvisions",
  "assignmentClause",
  "subrogationClause",
  "otherInsuranceClause",
  "summary",
  "metadataSource",
  "documentMetadata",
  "documentOutline",
  "sourceTreeVersion",
  "sourceTreeStatus",
  "sourceTreeUpdatedAt",
  "operationalProfile",
  "document",
  "declarations",
  "supplementaryFacts",
  "extractionReview",
  "files",
] as const;

function nowMs(): number {
  return dayjs().valueOf();
}

function snapshotPolicyForVersion(policy: Doc<"policies">): PolicySnapshot {
  const source = policy as unknown as Record<string, unknown>;
  return Object.fromEntries(
    CERTIFICATE_VISIBLE_POLICY_FIELDS
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]]),
  );
}

async function listPolicyFiles(ctx: { db: any }, policyId: Id<"policies">) {
  return await ctx.db
    .query("policyFiles")
    .withIndex("by_policyId", (q: any) => q.eq("policyId", policyId))
    .collect() as Doc<"policyFiles">[];
}

async function nextVersionNumber(ctx: { db: any }, policyId: Id<"policies">) {
  const versions = await ctx.db
    .query("policyVersions")
    .withIndex("by_policyId_versionNumber", (q: any) => q.eq("policyId", policyId))
    .collect() as Doc<"policyVersions">[];
  return versions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
}

function resolveEventType(args: {
  requestedEventType?: PolicyVersionEvent;
  policy: Doc<"policies">;
  versionNumber: number;
}): PolicyVersionEvent {
  if (args.requestedEventType) return args.requestedEventType;
  if (args.versionNumber === 1) return "initial_extraction";
  if (args.policy.isRenewal) return "renewal";
  return "re_extraction";
}

export async function createPolicyVersionForPolicyEvent(ctx: { db: any }, args: {
  policyId: Id<"policies">;
  eventType?: PolicyVersionEvent;
  sourcePolicyFileIds?: Id<"policyFiles">[];
  sourceFileIds?: Id<"_storage">[];
  policyUpdateRunId?: Id<"policyUpdateRuns">;
  policyChangeCaseId?: Id<"policyChangeCases">;
  createdByUserId?: Id<"users">;
  summary?: string;
  makeCurrent?: boolean;
  nowMs?: number;
}) {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");

    const versionNumber = await nextVersionNumber(ctx, args.policyId);
    const eventType = resolveEventType({
      requestedEventType: args.eventType,
      policy,
      versionNumber,
    });
    const policyFiles = await listPolicyFiles(ctx, args.policyId);
    const sourcePolicyFileIds = args.sourcePolicyFileIds ?? policyFiles.map((file) => file._id);
    const sourceFileIds = args.sourceFileIds ?? [
      ...(policy.fileId ? [policy.fileId] : []),
      ...policyFiles.map((file) => file.fileId),
    ];
    const uniqueSourceFileIds = Array.from(new Set(sourceFileIds));
    const createdAt = args.nowMs ?? nowMs();
    const policyVersionId = await ctx.db.insert("policyVersions", {
      orgId: policy.orgId,
      policyId: args.policyId,
      versionNumber,
      eventType,
      sourcePolicyFileIds,
      sourceFileIds: uniqueSourceFileIds,
      primaryFileId: uniqueSourceFileIds[0],
      policyUpdateRunId: args.policyUpdateRunId,
      policyChangeCaseId: args.policyChangeCaseId,
      createdByUserId: args.createdByUserId,
      summary: args.summary,
      snapshot: snapshotPolicyForVersion(policy),
      isCurrent: args.makeCurrent ?? true,
      createdAt,
    });

    if (args.makeCurrent ?? true) {
      const current = policy.currentPolicyVersionId
        ? await ctx.db.get(policy.currentPolicyVersionId)
        : null;
      if (current?.isCurrent) {
        await ctx.db.patch(current._id, { isCurrent: false });
      }
      await ctx.db.patch(args.policyId, { currentPolicyVersionId: policyVersionId });
    }

  return policyVersionId;
}

export const createForPolicyEvent = internalMutation({
  args: {
    policyId: v.id("policies"),
    eventType: v.optional(policyVersionEventValidator),
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    policyUpdateRunId: v.optional(v.id("policyUpdateRuns")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    createdByUserId: v.optional(v.id("users")),
    summary: v.optional(v.string()),
    makeCurrent: v.optional(v.boolean()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => createPolicyVersionForPolicyEvent(ctx, args),
});

export const listForPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const access = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!access) return [];
    const versions = await ctx.db
      .query("policyVersions")
      .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", args.policyId))
      .collect();
    return versions.sort((a, b) => b.versionNumber - a.versionNumber);
  },
});

export const getCurrentForPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const access = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!access) return null;
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.currentPolicyVersionId) return null;
    return await ctx.db.get(policy.currentPolicyVersionId);
  },
});
