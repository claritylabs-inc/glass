import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import {
  requireBrokerAccessToClient,
  assertCanUploadPolicy,
  assertCanDeletePolicy,
  assertCanReadPolicies,
  assertCanReadPolicy,
  getOrgAccess as getOrgAccessFor,
} from "./lib/access";
import { recordBrokerActivity } from "./lib/brokerActivity";
import { notify } from "./lib/notify";
import type { Id as DataModelId } from "./_generated/dataModel";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

type PolicyPipelineStatus = "idle" | "running" | "paused" | "complete" | "error";
type PolicyExtractionArtifactKind = "cl_sdk_checkpoint" | "embedding_payload";
type PolicyPipelineLogEntry = {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

const PIPELINE_LOG_LIMIT = 500;
const PIPELINE_STALE_REQUEUE_MS = 5 * 60 * 1000;
const PIPELINE_STALE_REQUEUE_BATCH_LIMIT = 25;
const EXTERNAL_WORKER_CLAIM_BATCH_LIMIT = 50;

function nowMs(): number {
  return dayjs().valueOf();
}

function policyYearFromInput(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = dayjs(
    value.trim(),
    ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD", "YYYY/M/D"],
    true,
  );
  return parsed.isValid() ? parsed.year() : undefined;
}

async function getPolicyExtractionRun(ctx: any, policyId: DataModelId<"policies">) {
  return await ctx.db
    .query("policyExtractionRuns")
    .withIndex("by_policyId", (q: any) => q.eq("policyId", policyId))
    .first();
}

async function readPolicyPipelineState(ctx: any, policyId: DataModelId<"policies">) {
  const run = await getPolicyExtractionRun(ctx, policyId);
  if (run) {
    return {
      pipelineStatus: run.pipelineStatus as PolicyPipelineStatus,
      pipelineError: run.pipelineError,
      pipelineCheckpoint: run.pipelineCheckpoint,
      pipelineLog: run.pipelineLog,
    };
  }

  const policy = await ctx.db.get(policyId);
  if (!policy) return null;
  return {
    pipelineStatus: (policy.pipelineStatus ?? "idle") as PolicyPipelineStatus,
    pipelineError: policy.pipelineError,
    pipelineCheckpoint: policy.pipelineCheckpoint,
    pipelineLog: policy.pipelineLog,
  };
}

async function mergePolicyPipelineState<T extends { _id: DataModelId<"policies"> }>(
  ctx: any,
  policy: T,
): Promise<T> {
  const state = await readPolicyPipelineState(ctx, policy._id);
  if (!state) return policy;
  return {
    ...policy,
    pipelineStatus: state.pipelineStatus,
    pipelineError: state.pipelineError,
    pipelineCheckpoint: state.pipelineCheckpoint,
    pipelineLog: state.pipelineLog,
  };
}

async function ensurePolicyExtractionRun(ctx: any, policyId: DataModelId<"policies">) {
  const existing = await getPolicyExtractionRun(ctx, policyId);
  if (existing) return existing;

  const policy = await ctx.db.get(policyId);
  const now = Date.now();
  const fields: Record<string, unknown> = {
    policyId,
    pipelineStatus: (policy?.pipelineStatus ?? "idle") as PolicyPipelineStatus,
    createdAt: now,
    updatedAt: now,
  };
  if (policy?.pipelineError) fields.pipelineError = policy.pipelineError;
  if (policy?.pipelineCheckpoint) fields.pipelineCheckpoint = policy.pipelineCheckpoint;
  if (Array.isArray(policy?.pipelineLog)) fields.pipelineLog = policy.pipelineLog;

  const runId = await ctx.db.insert("policyExtractionRuns", fields as any);
  if (policy?.pipelineCheckpoint || policy?.pipelineLog) {
    await ctx.db.patch(policyId, {
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
  }
  return await ctx.db.get(runId);
}

async function patchPolicyExtractionRun(
  ctx: any,
  policyId: DataModelId<"policies">,
  patch: Record<string, unknown>,
) {
  const run = await ensurePolicyExtractionRun(ctx, policyId);
  if (!run) return null;
  await ctx.db.patch(run._id, { ...patch, updatedAt: Date.now() });
  return await ctx.db.get(run._id);
}

async function clearPolicyExtractionArtifacts(
  ctx: any,
  policyId: DataModelId<"policies">,
  kind?: PolicyExtractionArtifactKind,
) {
  const query = kind
    ? ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("by_policyId_kind", (q: any) => q.eq("policyId", policyId).eq("kind", kind))
    : ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("by_policyId", (q: any) => q.eq("policyId", policyId));
  const artifacts = await query.collect();
  for (const artifact of artifacts) {
    await ctx.storage.delete(artifact.storageId).catch(() => {});
    await ctx.db.delete(artifact._id);
  }
}

async function setPolicyPipelineStatus(
  ctx: any,
  policyId: DataModelId<"policies">,
  status: PolicyPipelineStatus,
  error: string | null,
) {
  await patchPolicyExtractionRun(ctx, policyId, {
    pipelineStatus: status,
    pipelineError: error ?? undefined,
  });
  await ctx.db.patch(policyId, {
    pipelineStatus: status,
    pipelineError: error ?? undefined,
    pipelineCheckpoint: undefined,
    pipelineLog: undefined,
  });
}

async function appendPolicyPipelineLog(
  ctx: any,
  policyId: DataModelId<"policies">,
  entry: PolicyPipelineLogEntry,
) {
  const run = await ensurePolicyExtractionRun(ctx, policyId);
  if (!run) return;
  const existing = Array.isArray(run.pipelineLog) ? run.pipelineLog : [];
  const next = [...existing, entry].slice(-PIPELINE_LOG_LIMIT);
  await ctx.db.patch(run._id, {
    pipelineLog: next,
    updatedAt: Date.now(),
  });
}

export const list = query({
  args: {
    carrier: v.optional(v.string()),
    policyYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.filter(
      (p) =>
        p.pipelineStatus === "complete" &&
        !p.deletedAt &&
        (!args.carrier || p.carrier === args.carrier) &&
        (!args.policyYear || p.policyYear === args.policyYear)
    );
  },
});

export const listQuotes = query({
  args: {
    carrier: v.optional(v.string()),
    quoteYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.filter(
      (p) =>
        p.documentType === "quote" &&
        p.pipelineStatus === "complete" &&
        !p.deletedAt &&
        (!args.carrier || p.carrier === args.carrier) &&
        (!args.quoteYear || p.policyYear === args.quoteYear)
    );
  },
});

export const quoteStats = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { totalQuotes: 0, pendingExtractions: 0, byType: {}, byCarrier: {}, byYear: {} };
    const { orgId } = access;
    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();

    const quotes = allPolicies.filter((p) => p.documentType === "quote" && p.pipelineStatus === "complete" && !p.deletedAt);
    const pendingExtractions = allPolicies.filter(
      (p) =>
        p.documentType === "quote" &&
        !p.deletedAt &&
        (p.pipelineStatus === "running" || p.pipelineStatus === "error" || !p.pipelineStatus)
    ).length;

    const byType: Record<string, number> = {};
    const byCarrier: Record<string, number> = {};
    const byYear: Record<string, number> = {};

    for (const q of quotes) {
      const types = q.policyTypes ?? ["other"];
      for (const t of types) {
        byType[t] = (byType[t] || 0) + 1;
      }
      byCarrier[q.carrier] = (byCarrier[q.carrier] || 0) + 1;
      byYear[q.policyYear] = (byYear[q.policyYear] || 0) + 1;
    }

    return {
      totalQuotes: quotes.length,
      pendingExtractions,
      byType,
      byCarrier,
      byYear,
    };
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const pending = all.filter(
      (p) =>
        !p.deletedAt &&
        (p.pipelineStatus === "running" ||
        p.pipelineStatus === "paused" ||
        p.pipelineStatus === "error" ||
        !p.pipelineStatus)
    );

    const enriched = pending.map((p) => {
      const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
      return {
        ...rest,
        hasRawResponse: !!rawExtractionResponse,
        hasRawMetadata: !!rawMetadataResponse,
      };
    });

    return enriched;
  },
});

export const listExtractionLog = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const completed = all.filter(
      (p) =>
        !p.deletedAt &&
        (p.pipelineStatus === "complete" || p.dismissed === true)
    );

    const enriched = completed.map((p) => {
      const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
      return {
        ...rest,
        hasRawResponse: !!rawExtractionResponse,
        hasRawMetadata: !!rawMetadataResponse,
      };
    });

    return enriched;
  },
});

export const get = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy || !policy.orgId) return null;
    try {
      await getOrgAccessFor(ctx, policy.orgId);
    } catch {
      return null;
    }
    const enrichedPolicy = await mergePolicyPipelineState(ctx, policy);
    return {
      ...enrichedPolicy,
      hasRawResponse: !!policy.rawExtractionResponse,
      hasRawMetadata: !!policy.rawMetadataResponse,
    };
  },
});

export const getFileUrl = query({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx);
    return await ctx.storage.getUrl(args.fileId);
  },
});

// All complete, non-deleted policies for an org (used by agent action)
export const listAllInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(
      (p) => p.pipelineStatus === "complete" && !p.deletedAt
    );
  },
});

// All complete, non-deleted quotes for an org (used by agent action)
export const listAllQuotesInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(
      (p) => p.documentType === "quote" && p.pipelineStatus === "complete" && !p.deletedAt
    );
  },
});

// Legacy: support userId-based lookup during transition
export const listAllInternalByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_userId", (idx) => idx.eq("userId", args.userId as unknown as never))
      .collect();
    return all.filter(
      (p) => p.pipelineStatus === "complete" && !p.deletedAt
    );
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { totalPolicies: 0, activeConnections: 0, lastScanAt: null, pendingExtractions: 0, byType: {}, byCarrier: {}, byYear: {} };
    const { orgId } = access;
    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const policies = allPolicies.filter((p) => p.pipelineStatus === "complete" && !p.deletedAt);
    const pendingExtractions = allPolicies.filter(
      (p) =>
        !p.deletedAt &&
        (p.pipelineStatus === "running" || p.pipelineStatus === "error" || !p.pipelineStatus)
    ).length;

    const byType: Record<string, number> = {};
    const byCarrier: Record<string, number> = {};
    const byYear: Record<string, number> = {};

    for (const p of policies) {
      const policyLegacy = p as unknown as Record<string, unknown>;
      const types = p.policyTypes ?? (policyLegacy.policyType ? [policyLegacy.policyType as string] : ["other"]);
      for (const t of types) {
        byType[t] = (byType[t] || 0) + 1;
      }
      byCarrier[p.carrier] = (byCarrier[p.carrier] || 0) + 1;
      byYear[p.policyYear] = (byYear[p.policyYear] || 0) + 1;
    }

    return {
      totalPolicies: policies.length,
      activeConnections: 0,
      lastScanAt: null,
      pendingExtractions,
      byType,
      byCarrier,
      byYear,
    };
  },
});

// Shared validators for coverages and document structure
const coverageValidator = v.object({
  name: v.string(),
  coverageCode: v.optional(v.string()),
  formEditionDate: v.optional(v.string()),
  limit: v.optional(v.string()),
  limitType: v.optional(v.string()),
  limitValueType: v.optional(v.string()),
  deductible: v.optional(v.string()),
  deductibleType: v.optional(v.string()),
  deductibleValueType: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  sir: v.optional(v.string()),
  sublimit: v.optional(v.string()),
  coinsurance: v.optional(v.string()),
  valuation: v.optional(v.string()),
  territory: v.optional(v.string()),
  trigger: v.optional(v.string()),
  retroactiveDate: v.optional(v.string()),
  included: v.optional(v.boolean()),
  coveragePremium: v.optional(v.string()),
  premium: v.optional(v.string()),
  pageNumber: v.optional(v.number()),
  resolvedFromPage: v.optional(v.number()),
  sectionRef: v.optional(v.string()),
  originalContent: v.optional(v.string()),
  resolvedOriginalContent: v.optional(v.string()),
  recordId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
});

const premiumLineValidator = v.object({
  line: v.string(),
  amount: v.string(),
});

const addressValidator = v.object({
  street1: v.string(),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
});

const limitsValidator = v.object({
  perOccurrence: v.optional(v.string()),
  generalAggregate: v.optional(v.string()),
  productsCompletedOpsAggregate: v.optional(v.string()),
  personalAdvertisingInjury: v.optional(v.string()),
  eachEmployee: v.optional(v.string()),
  fireDamage: v.optional(v.string()),
  medicalExpense: v.optional(v.string()),
  combinedSingleLimit: v.optional(v.string()),
  bodilyInjuryPerPerson: v.optional(v.string()),
  bodilyInjuryPerAccident: v.optional(v.string()),
  propertyDamage: v.optional(v.string()),
  eachOccurrenceUmbrella: v.optional(v.string()),
  umbrellaAggregate: v.optional(v.string()),
  umbrellaRetention: v.optional(v.string()),
  statutory: v.optional(v.boolean()),
  employersLiability: v.optional(v.object({
    eachAccident: v.string(),
    diseasePolicyLimit: v.string(),
    diseaseEachEmployee: v.string(),
  })),
  sublimits: v.optional(v.array(v.object({
    name: v.string(),
    limit: v.string(),
    appliesTo: v.optional(v.string()),
    deductible: v.optional(v.string()),
  }))),
  sharedLimits: v.optional(v.array(v.object({
    description: v.string(),
    limit: v.string(),
    coverageParts: v.array(v.string()),
  }))),
  defenseCostTreatment: v.optional(v.string()),
});

const deductiblesValidator = v.object({
  perClaim: v.optional(v.string()),
  perOccurrence: v.optional(v.string()),
  aggregateDeductible: v.optional(v.string()),
  selfInsuredRetention: v.optional(v.string()),
  corridorDeductible: v.optional(v.string()),
  waitingPeriod: v.optional(v.string()),
  appliesTo: v.optional(v.string()),
});

const locationValidator = v.object({
  number: v.number(),
  address: addressValidator,
  description: v.optional(v.string()),
  buildingValue: v.optional(v.string()),
  contentsValue: v.optional(v.string()),
  businessIncomeValue: v.optional(v.string()),
  constructionType: v.optional(v.string()),
  yearBuilt: v.optional(v.number()),
  squareFootage: v.optional(v.number()),
  protectionClass: v.optional(v.string()),
  sprinklered: v.optional(v.boolean()),
  alarmType: v.optional(v.string()),
  occupancy: v.optional(v.string()),
});

const vehicleValidator = v.object({
  number: v.number(),
  year: v.number(),
  make: v.string(),
  model: v.string(),
  vin: v.string(),
  costNew: v.optional(v.string()),
  statedValue: v.optional(v.string()),
  garageLocation: v.optional(v.number()),
  coverages: v.optional(v.array(v.object({
    type: v.string(),
    limit: v.optional(v.string()),
    deductible: v.optional(v.string()),
    included: v.boolean(),
  }))),
  radius: v.optional(v.string()),
  vehicleType: v.optional(v.string()),
});

const classificationValidator = v.object({
  code: v.string(),
  description: v.string(),
  premiumBasis: v.string(),
  basisAmount: v.optional(v.string()),
  rate: v.optional(v.string()),
  premium: v.optional(v.string()),
  locationNumber: v.optional(v.number()),
});

const formReferenceValidator = v.object({
  formNumber: v.string(),
  editionDate: v.optional(v.string()),
  title: v.optional(v.string()),
  formType: v.string(),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
});

const taxFeeValidator = v.object({
  name: v.string(),
  amount: v.string(),
  type: v.optional(v.string()),
  description: v.optional(v.string()),
});

// Document structure from cl-sdk — uses v.any() because the schema evolves with cl-sdk versions.
// Contains sections, endorsements, conditions, exclusions, regulatory context, claims contact, etc.
const documentValidator = v.any();

const metadataSourceValidator = v.object({
  carrierPage: v.optional(v.number()),
  policyNumberPage: v.optional(v.number()),
  premiumPage: v.optional(v.number()),
  effectiveDatePage: v.optional(v.number()),
});

export const insert = mutation({
  args: {
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    carrier: v.string(),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    policyTypes: v.array(v.string()),
    documentType: v.union(v.literal("policy"), v.literal("quote")),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(coverageValidator),
    premium: v.optional(v.string()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    document: v.optional(documentValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("policies", args);
  },
});

export const updateExtraction = mutation({
  args: {
    id: v.id("policies"),
    carrier: v.optional(v.string()),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    // Enriched entity fields (cl-sdk 1.2+)
    carrierLegalName: v.optional(v.string()),
    carrierNaicNumber: v.optional(v.string()),
    carrierAmBestRating: v.optional(v.string()),
    carrierAdmittedStatus: v.optional(v.string()),
    brokerAgency: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerLicenseNumber: v.optional(v.string()),
    // Structured entity objects (cl-sdk 0.11+)
    insurer: v.optional(v.object({
      legalName: v.string(),
      naicNumber: v.optional(v.string()),
      amBestRating: v.optional(v.string()),
      amBestNumber: v.optional(v.string()),
      admittedStatus: v.optional(v.string()),
      stateOfDomicile: v.optional(v.string()),
    })),
    producer: v.optional(v.object({
      agencyName: v.string(),
      contactName: v.optional(v.string()),
      licenseNumber: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(addressValidator),
    })),
    lossPayees: v.optional(v.array(v.object({
      name: v.string(),
      role: v.string(),
      address: v.optional(addressValidator),
      relationship: v.optional(v.string()),
      scope: v.optional(v.string()),
    }))),
    mortgageHolders: v.optional(v.array(v.object({
      name: v.string(),
      role: v.string(),
      address: v.optional(addressValidator),
      relationship: v.optional(v.string()),
      scope: v.optional(v.string()),
    }))),
    priorPolicyNumber: v.optional(v.string()),
    programName: v.optional(v.string()),
    isPackage: v.optional(v.boolean()),
    // Insured details
    insuredDba: v.optional(v.string()),
    insuredAddress: v.optional(addressValidator),
    insuredEntityType: v.optional(v.string()),
    insuredFein: v.optional(v.string()),
    additionalNamedInsureds: v.optional(v.array(v.object({
      name: v.string(),
      relationship: v.optional(v.string()),
      address: v.optional(addressValidator),
    }))),
    // Coverage structure
    coverageForm: v.optional(v.string()),
    retroactiveDate: v.optional(v.string()),
    effectiveTime: v.optional(v.string()),
    limits: v.optional(limitsValidator),
    deductibles: v.optional(deductiblesValidator),
    // Locations, vehicles, classifications
    locations: v.optional(v.array(locationValidator)),
    vehicles: v.optional(v.array(vehicleValidator)),
    classifications: v.optional(v.array(classificationValidator)),
    formInventory: v.optional(v.array(formReferenceValidator)),
    taxesAndFees: v.optional(v.array(taxFeeValidator)),
    premiumBreakdown: v.optional(v.array(premiumLineValidator)),
    // Standard fields
    policyNumber: v.optional(v.string()),
    policyTypes: v.optional(v.array(v.string())),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
    policyYear: v.optional(v.number()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    isRenewal: v.optional(v.boolean()),
    coverages: v.optional(v.array(coverageValidator)),
    premium: v.optional(v.string()),
    totalCost: v.optional(v.string()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    document: v.optional(documentValidator),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    rawExtractionResponse: v.optional(v.string()),
    rawMetadataResponse: v.optional(v.string()),
    // Typed declarations (cl-sdk 1.4+)
    declarations: v.optional(v.any()),
    // cl-sdk 3.0+ fields
    policyTermType: v.optional(v.string()),
    nextReviewDate: v.optional(v.string()),
    minPremium: v.optional(v.string()),
    depositPremium: v.optional(v.string()),
    auditProvision: v.optional(v.boolean()),
    cancellationProvisions: v.optional(v.string()),
    nonRenewalProvisions: v.optional(v.string()),
    assignmentClause: v.optional(v.string()),
    subrogationClause: v.optional(v.string()),
    otherInsuranceClause: v.optional(v.string()),
    // Quote-specific fields (for documentType === "quote")
    quoteNumber: v.optional(v.string()),
    quoteYear: v.optional(v.number()),
    proposedEffectiveDate: v.optional(v.string()),
    proposedExpirationDate: v.optional(v.string()),
    quoteExpirationDate: v.optional(v.string()),
    subjectivities: v.optional(v.any()),
    underwritingConditions: v.optional(v.any()),
    enrichedSubjectivities: v.optional(v.any()),
    enrichedUnderwritingConditions: v.optional(v.any()),
    warrantyRequirements: v.optional(v.any()),
    // Supplementary extraction (cl-sdk 0.13+)
    supplementaryFacts: v.optional(v.array(v.object({
      key: v.string(),
      value: v.string(),
      subject: v.optional(v.string()),
      context: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);

    // Emit broker activity if extraction is now complete
    if ((fields as { pipelineStatus?: string }).pipelineStatus === "complete") {
      const policy = await ctx.db.get(id);
      if (policy?.orgId) {
        const org = await ctx.db.get(policy.orgId);
        if (org && (org as { brokerOrgId?: DataModelId<"organizations"> }).brokerOrgId) {
          await recordBrokerActivity(ctx, {
            brokerOrgId: (org as { brokerOrgId: DataModelId<"organizations"> }).brokerOrgId,
            clientOrgId: policy.orgId,
            type: "policy_extraction_completed",
            actorSide: "system",
            summary: `Policy ${(policy as { policyNumber?: string }).policyNumber ?? id} (${(policy as { carrier?: string }).carrier ?? "unknown carrier"}) extraction completed.`,
            payload: { policyId: id },
          });
        }
      }
    }
  },
});

export const updateExtractedFields = mutation({
  args: {
    id: v.id("policies"),
    fields: v.object({
      carrier: v.optional(v.string()),
      security: v.optional(v.string()),
      mga: v.optional(v.string()),
      broker: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      policyTypes: v.optional(v.array(v.string())),
      policyYear: v.optional(v.number()),
      effectiveDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      insuredName: v.optional(v.string()),
      premium: v.optional(v.string()),
      totalCost: v.optional(v.string()),
      minPremium: v.optional(v.string()),
      depositPremium: v.optional(v.string()),
      summary: v.optional(v.string()),
      coverages: v.optional(v.array(coverageValidator)),
      taxesAndFees: v.optional(v.array(taxFeeValidator)),
      premiumBreakdown: v.optional(v.array(premiumLineValidator)),
      limits: v.optional(v.any()),
      deductibles: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccessFor(ctx, policy.orgId);
    assertCanUploadPolicy(access);

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.fields)) {
      if (value !== undefined) patch[key] = value;
    }

    const derivedYear =
      args.fields.policyYear ?? policyYearFromInput(args.fields.effectiveDate);
    if (derivedYear !== undefined) patch.policyYear = derivedYear;

    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.id, patch);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "manual_policy_update",
      detail: `Updated ${Object.keys(patch).join(", ")}`,
      metadata: { fields: Object.keys(patch) },
    });
  },
});

export const confirmPolicyFactFromSource = internalMutation({
  args: {
    id: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    fact: v.string(),
    sourceSpanIds: v.array(v.string()),
    source: v.optional(v.union(
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
    )),
    fieldUpdates: v.optional(v.object({
      carrier: v.optional(v.string()),
      security: v.optional(v.string()),
      mga: v.optional(v.string()),
      broker: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      effectiveDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      insuredName: v.optional(v.string()),
      premium: v.optional(v.string()),
      totalCost: v.optional(v.string()),
      minPremium: v.optional(v.string()),
      depositPremium: v.optional(v.string()),
      summary: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== args.orgId) throw new Error("Policy not found");
    if (args.sourceSpanIds.length === 0) throw new Error("Source evidence is required");

    const policySpans = await ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.id))
      .collect();
    const validSpanIds = new Set(policySpans.map((span) => span.spanId));
    const invalidSpanIds = args.sourceSpanIds.filter((id) => !validSpanIds.has(id));
    if (invalidSpanIds.length > 0) {
      throw new Error("Source evidence was not found on this policy");
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.fieldUpdates ?? {})) {
      if (value !== undefined) patch[key] = value;
    }
    const derivedYear = policyYearFromInput(args.fieldUpdates?.effectiveDate);
    if (derivedYear !== undefined) patch.policyYear = derivedYear;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }

    const now = dayjs().valueOf();
    const memoryContent = `Policy ${policy.policyNumber ?? args.id}: ${args.fact}`;
    const existingFacts = await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", "fact"),
      )
      .collect();
    const duplicateFact = existingFacts.find((memory) => memory.content === memoryContent);
    if (duplicateFact) {
      await ctx.db.patch(duplicateFact._id, { updatedAt: now });
    } else {
      await ctx.db.insert("orgMemory", {
        orgId: args.orgId,
        type: "fact",
        content: memoryContent,
        source: args.source ?? "chat",
        policyId: args.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: args.userId,
      orgId: args.orgId,
      action: "agent_confirmed_policy_fact",
      detail: args.fact,
      metadata: {
        sourceSpanIds: args.sourceSpanIds,
        fields: Object.keys(patch),
      },
    });

    return {
      updatedFields: Object.keys(patch),
      sourceSpanIds: args.sourceSpanIds,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrgAccess(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Broker uploads a policy or quote on behalf of a client org.
// Requires broker_of_client access to the clientOrgId.
export const createBrokerUpload = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    documentType: v.union(v.literal("policy"), v.literal("quote")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
    assertCanUploadPolicy(access);

    const policyId = await ctx.db.insert("policies", {
      orgId: args.clientOrgId,
      fileId: args.fileId,
      fileName: args.fileName,
      documentType: args.documentType,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyTypes: ["other"],
      policyYear: new Date().getFullYear(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
      uploadedBySide: "broker",
      uploadedByUserId: access.userId,
      uploadedByBrokerOrgId: access.brokerOrgId,
    });

    // Emit broker-activity event for upload
    await recordBrokerActivity(ctx, {
      brokerOrgId: access.brokerOrgId,
      clientOrgId: args.clientOrgId,
      type: args.documentType === "quote" ? "policy_uploaded" : "policy_uploaded",
      actorUserId: access.userId,
      actorSide: "broker",
      payload: {
        policyId,
        documentType: args.documentType,
        uploadedBySide: "broker",
      },
      summary: `Broker uploaded a ${args.documentType} on behalf of client`,
    });

    // Notify client of policy/quote delivery
    const brokerOrg = await ctx.db.get(access.brokerOrgId);
    const notifType = args.documentType === "quote" ? "quote_delivered_by_broker" as const : "policy_delivered_by_broker" as const;
    const notifTitle = args.documentType === "quote" ? "New quote available" : "New policy available";
    const notifBody = args.documentType === "quote"
      ? `${brokerOrg?.name ?? "Your broker"} delivered a new quote.`
      : `${brokerOrg?.name ?? "Your broker"} delivered a new policy.`;
    await notify(ctx, {
      orgId: args.clientOrgId,
      type: notifType,
      title: notifTitle,
      body: notifBody,
      relatedOrgId: access.brokerOrgId,
      actionType: "view_policy",
      actionPayload: { policyId },
    });

    return policyId;
  },
});

// Broker queries all policies for a client org they manage.
export const listForBroker = query({
  args: {
    clientOrgId: v.id("organizations"),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccessFor(ctx, args.clientOrgId);
    assertCanReadPolicy(access);
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.clientOrgId))
      .collect();
    return all.filter(
      (p) =>
        !p.deletedAt &&
        (!args.documentType || p.documentType === args.documentType),
    );
  },
});

// Client queries their own policies (explicit about side).
export const listForClient = query({
  args: {
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const filtered = all.filter(
      (p) =>
        !p.dismissed &&
        !p.deletedAt &&
        (!args.documentType || p.documentType === args.documentType),
    );
    return await Promise.all(filtered.map((p) => mergePolicyPipelineState(ctx, p)));
  },
});

export const dismiss = mutation({
  args: {
    id: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { dismissed: true });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "dismissed",
    });
  },
});

export const setExcludeFromSearch = mutation({
  args: {
    id: v.id("policies"),
    exclude: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { excludeFromSearch: args.exclude });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: args.exclude ? "excluded_from_search" : "included_in_search",
    });
  },
});

export const pauseExtraction = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    const state = await readPolicyPipelineState(ctx, args.id);
    if (state?.pipelineStatus !== "running") throw new Error("Can only pause extracting policies");
    await setPolicyPipelineStatus(ctx, args.id, "paused", null);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "paused",
    });
  },
});

export const resumeExtraction = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    const state = await readPolicyPipelineState(ctx, args.id);
    if (state?.pipelineStatus !== "paused") throw new Error("Can only resume paused policies");
    await setPolicyPipelineStatus(ctx, args.id, "running", null);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "resumed",
    });
  },
});

export const cancelExtraction = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    const state = await readPolicyPipelineState(ctx, args.id);
    const cancelable = ["idle", "running", "paused", "error"];
    if (state?.pipelineStatus && !cancelable.includes(state.pipelineStatus)) {
      throw new Error("Cannot cancel a completed extraction");
    }
    await patchPolicyExtractionRun(ctx, args.id, {
      pipelineStatus: "error",
      pipelineError: "Cancelled by user",
      pipelineCheckpoint: undefined,
    });
    await clearPolicyExtractionArtifacts(ctx, args.id);
    await appendPolicyPipelineLog(ctx, args.id, {
      timestamp: Date.now(),
      message: "Extraction cancelled by user",
      phase: "cancel",
      level: "warn",
    });
    await ctx.db.patch(args.id, {
      pipelineStatus: "error",
      pipelineError: "Cancelled by user",
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "cancelled",
    });
  },
});

export const restartExtraction = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");

    // Clear all extracted data for a fresh start
    await patchPolicyExtractionRun(ctx, args.id, {
      pipelineStatus: "idle",
      pipelineError: undefined,
      pipelineCheckpoint: undefined,
      pipelineLog: [],
    });
    await clearPolicyExtractionArtifacts(ctx, args.id);
    await ctx.db.patch(args.id, {
      pipelineStatus: "idle",
      pipelineError: undefined,
      pipelineLog: undefined,
      pipelineCheckpoint: undefined,
      dismissed: undefined,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      insuredName: "Extracting...",
      summary: undefined,
      coverages: [],
      rawExtractionResponse: undefined,
      rawMetadataResponse: undefined,
      document: undefined,
      metadataSource: undefined,
    });

    // Schedule fresh extraction from stored file
    if (policy.fileId) {
      await ctx.scheduler.runAfter(0, api.actions.retryExtraction.retryExtraction, {
        policyId: args.id,
        mode: "full" as const,
      });
    }

    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "restarted",
    });
  },
});

export const softDelete = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    // Capability check: broker_of_client users can only delete their own uploads
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();
    if (!membership && policy.orgId) {
      // Broker-of-client path: check ownership
      assertCanDeletePolicy(
        {
          accessType: "broker_of_client",
          userId,
          org: { _id: orgId } as any,
          orgType: "client",
          role: undefined,
          brokerOrgId: policy.uploadedByBrokerOrgId,
        },
        policy,
      );
    }
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "deleted",
    });
  },
});

export const appendExtractionLog = internalMutation({
  args: {
    id: v.id("policies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return;
    await appendPolicyPipelineLog(ctx, args.id, {
      timestamp: Date.now(),
      message: args.message,
    });
  },
});

export const clearExtractionLog = internalMutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    await patchPolicyExtractionRun(ctx, args.id, { pipelineLog: [] });
    await ctx.db.patch(args.id, { pipelineLog: undefined });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return null;
    return await mergePolicyPipelineState(ctx, policy);
  },
});

// All complete, non-deleted policies+quotes for an org (used by DocumentStore)
export const listByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
  },
});

// Internal update extraction (no auth check — used by DocumentStore.save and extraction pipeline)
export const updateExtractionInternal = internalMutation({
  args: {
    id: v.id("policies"),
    fields: v.any(), // Accept any policy fields from insuranceDocToPolicy
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.fields);
  },
});

// Internal soft delete (no auth check — used by DocumentStore.delete)
export const softDeleteInternal = internalMutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const updateAnalysis = internalMutation({
  args: {
    id: v.id("policies"),
    analysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { analysis: args.analysis });
  },
});

// Update the denormalized files array on a policy, and optionally reconciliationStatus / emailIds
export const updateFiles = internalMutation({
  args: {
    id: v.id("policies"),
    files: v.optional(v.array(v.object({
      fileId: v.id("_storage"),
      fileName: v.string(),
      fileType: v.string(),
      status: v.string(),
    }))),
    reconciliationStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("reconciled"),
      v.literal("error"),
    )),
    primaryFileId: v.optional(v.id("_storage")),
    primaryFileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, any> = {};
    if (fields.files !== undefined) patch.files = fields.files;
    if (fields.reconciliationStatus !== undefined) patch.reconciliationStatus = fields.reconciliationStatus;
    if (fields.primaryFileId !== undefined) patch.fileId = fields.primaryFileId;
    if (fields.primaryFileName !== undefined) patch.fileName = fields.primaryFileName;
    await ctx.db.patch(id, patch);
  },
});

// Atomically append to the reconciliationLog array on a policy
export const appendReconciliationLog = internalMutation({
  args: {
    id: v.id("policies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return;
    const existing = (policy as any).reconciliationLog ?? [];
    existing.push({ timestamp: Date.now(), message: args.message });
    await ctx.db.patch(args.id, { reconciliationLog: existing } as any);
  },
});

// Update reconciliation status and optionally policy fields (used by reconcilePolicy action)
export const updateReconciliation = internalMutation({
  args: {
    id: v.id("policies"),
    reconciliationStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("reconciled"),
      v.literal("error"),
    )),
    fields: v.optional(v.any()), // Reconciled extraction fields to patch onto the policy
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.reconciliationStatus !== undefined) patch.reconciliationStatus = args.reconciliationStatus;
    if (args.fields) Object.assign(patch, args.fields);
    await ctx.db.patch(args.id, patch);
  },
});

export const restore = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { deletedAt: undefined });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "restored",
    });
  },
});

export const remove = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");

    // Delete associated document chunks
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_policyId", (idx) => idx.eq("policyId", args.id))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccessFor(ctx, args.orgId);
    assertCanReadPolicies(access);
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    const filtered = all.filter(
      (policy) =>
        !policy.deletedAt &&
        !policy.dismissed &&
        (!args.documentType || policy.documentType === args.documentType),
    );
    return await Promise.all(
      filtered.map((policy) => mergePolicyPipelineState(ctx, policy)),
    );
  },
});

export const pipelineSaveArtifact = internalMutation({
  args: {
    jobId: v.string(),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
    ),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { jobId, kind, storageId }) => {
    const policyId = jobId as DataModelId<"policies">;
    await ensurePolicyExtractionRun(ctx, policyId);
    await clearPolicyExtractionArtifacts(ctx, policyId, kind);
    const now = Date.now();
    await ctx.db.insert("policyExtractionArtifacts", {
      policyId,
      kind,
      storageId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const pipelineGetArtifact = internalQuery({
  args: {
    jobId: v.string(),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
    ),
  },
  handler: async (ctx, { jobId, kind }) => {
    return await ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("by_policyId_kind", (q) =>
        q.eq("policyId", jobId as DataModelId<"policies">).eq("kind", kind),
      )
      .order("desc")
      .first();
  },
});

export const pipelineClearArtifacts = internalMutation({
  args: {
    jobId: v.string(),
    kind: v.optional(v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
    )),
  },
  handler: async (ctx, { jobId, kind }) => {
    await clearPolicyExtractionArtifacts(
      ctx,
      jobId as DataModelId<"policies">,
      kind,
    );
  },
});

// ── cl-pipelines contract mutations for policies ───────────────────────────────
const PIPELINE_LEGACY_LEASE_STALE_MS = 5 * 60 * 1000;

export const pipelineGetJob = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const state = await readPolicyPipelineState(ctx, jobId as DataModelId<"policies">);
    if (!state) return null;
    return {
      status: state.pipelineStatus,
      checkpoint: state.pipelineCheckpoint ?? null,
      error: state.pipelineError,
    };
  },
});

export const pipelineSetStatus = internalMutation({
  args: {
    jobId: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("error"),
    ),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { jobId, status, error }) => {
    await setPolicyPipelineStatus(
      ctx,
      jobId as DataModelId<"policies">,
      status,
      error,
    );
  },
});

export const pipelineSetCheckpoint = internalMutation({
  args: { jobId: v.string(), checkpoint: v.optional(v.any()) },
  handler: async (ctx, { jobId, checkpoint }) => {
    await patchPolicyExtractionRun(ctx, jobId as DataModelId<"policies">, {
      pipelineCheckpoint: checkpoint ?? undefined,
    });
    await ctx.db.patch(jobId as DataModelId<"policies">, {
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
  },
});

export const pipelineAppendLog = internalMutation({
  args: {
    jobId: v.string(),
    timestamp: v.number(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, timestamp, message, phase, level }) => {
    const entry: PolicyPipelineLogEntry = {
      timestamp,
      message,
    };
    if (phase !== undefined) entry.phase = phase;
    if (level !== undefined) entry.level = level;
    await appendPolicyPipelineLog(ctx, jobId as DataModelId<"policies">, entry);
  },
});

export const pipelineClearLog = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    await patchPolicyExtractionRun(ctx, jobId as DataModelId<"policies">, {
      pipelineLog: [],
    });
    await ctx.db.patch(jobId as DataModelId<"policies">, {
      pipelineLog: undefined,
    });
  },
});

export const pipelineStartExternalWorkerJob = internalMutation({
  args: {
    jobId: v.string(),
    state: v.any(),
  },
  handler: async (ctx, { jobId, state }) => {
    const policyId = jobId as DataModelId<"policies">;
    const now = nowMs();
    await patchPolicyExtractionRun(ctx, policyId, {
      pipelineStatus: "running",
      pipelineError: undefined,
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {
          ...state,
          externalWorker: true,
        },
        createdAt: now,
      },
    });
    await ctx.db.patch(policyId, {
      pipelineStatus: "running",
      pipelineError: undefined,
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
    await appendPolicyPipelineLog(ctx, policyId, {
      timestamp: now,
      message: "Queued for external extraction worker",
      phase: "queue",
      level: "info",
    });
  },
});

export const pipelineClaimExternalWorkerJob = internalMutation({
  args: {
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = nowMs();
    const batchSize = Math.max(
      1,
      Math.min(
        EXTERNAL_WORKER_CLAIM_BATCH_LIMIT,
        Math.floor(args.batchSize ?? EXTERNAL_WORKER_CLAIM_BATCH_LIMIT),
      ),
    );
    const runs = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("by_pipelineStatus_updatedAt", (q) => q.eq("pipelineStatus", "running"))
      .order("asc")
      .take(batchSize);

    for (const run of runs) {
      const checkpoint = run.pipelineCheckpoint as
        | {
            nextPhase?: string;
            state?: { externalWorker?: boolean; fileId?: string };
            createdAt?: number;
            lease?: { id?: string; phase?: string; expiresAt?: number; heartbeatAt?: number };
          }
        | undefined;
      if (
        checkpoint?.nextPhase !== "extract" ||
        !checkpoint.state?.externalWorker ||
        !checkpoint.state.fileId
      ) {
        continue;
      }

      const heartbeatAt = checkpoint.lease?.heartbeatAt;
      const lastLogAt = run.pipelineLog?.at(-1)?.timestamp ?? checkpoint.createdAt ?? run.updatedAt;
      const activeLease =
        checkpoint.lease?.expiresAt !== undefined &&
        checkpoint.lease.expiresAt > now &&
        (
          heartbeatAt === undefined
            ? now - lastLogAt <= PIPELINE_STALE_REQUEUE_MS
            : now - heartbeatAt <= PIPELINE_STALE_REQUEUE_MS
        );
      if (activeLease) continue;

      const leasedCheckpoint = {
        ...checkpoint,
        lease: {
          id: args.leaseId,
          phase: "external_extract",
          expiresAt: args.leaseExpiresAt,
          heartbeatAt: now,
        },
      };
      await ctx.db.patch(run._id, {
        pipelineCheckpoint: leasedCheckpoint,
        updatedAt: now,
      });
      await appendPolicyPipelineLog(ctx, run.policyId, {
        timestamp: now,
        message: "External extraction worker claimed job",
        phase: "worker",
        level: "info",
      });
      return {
        policyId: String(run.policyId),
        checkpoint: leasedCheckpoint,
      };
    }

    return null;
  },
});

export const pipelineRequeueStale = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = nowMs();
    const olderThanMs = Math.max(
      PIPELINE_STALE_REQUEUE_MS,
      Math.floor(args.olderThanMs ?? PIPELINE_STALE_REQUEUE_MS),
    );
    const batchSize = Math.max(
      1,
      Math.min(
        PIPELINE_STALE_REQUEUE_BATCH_LIMIT,
        Math.floor(args.batchSize ?? PIPELINE_STALE_REQUEUE_BATCH_LIMIT),
      ),
    );
    const cutoff = now - olderThanMs;
    const runs = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("by_pipelineStatus_updatedAt", (q) =>
        q.eq("pipelineStatus", "running").lt("updatedAt", cutoff),
      )
      .order("asc")
      .take(batchSize);

    const requeued: string[] = [];
    const markedError: string[] = [];
    const skipped: string[] = [];

    for (const run of runs) {
      const checkpoint = run.pipelineCheckpoint as
        | {
            nextPhase?: string;
            state?: { externalWorker?: boolean };
            createdAt?: number;
            lease?: { id?: string; phase?: string; expiresAt?: number; heartbeatAt?: number };
          }
        | undefined;

      if (!checkpoint) {
        await setPolicyPipelineStatus(
          ctx,
          run.policyId,
          "error",
          "Extraction stalled without a resumable checkpoint",
        );
        await appendPolicyPipelineLog(ctx, run.policyId, {
          timestamp: now,
          message: "Marked extraction failed because no resumable checkpoint was available",
          phase: "watchdog",
          level: "error",
        });
        markedError.push(String(run.policyId));
        continue;
      }

      const lastLogAt = run.pipelineLog?.at(-1)?.timestamp ?? checkpoint.createdAt ?? run.updatedAt;
      const heartbeatAt = checkpoint.lease?.heartbeatAt;
      const heartbeatStale =
        heartbeatAt === undefined
          ? now - lastLogAt > olderThanMs
          : now - heartbeatAt > olderThanMs;
      if (!heartbeatStale) {
        skipped.push(String(run.policyId));
        continue;
      }

      if (checkpoint.state?.externalWorker && checkpoint.nextPhase === "extract") {
        await appendPolicyPipelineLog(ctx, run.policyId, {
          timestamp: now,
          message: "Stale external extraction lease detected; clearing lease for worker reclaim",
          phase: "watchdog",
          level: "warn",
        });
        await ctx.db.patch(run._id, {
          pipelineCheckpoint: {
            ...checkpoint,
            lease: undefined,
          },
          updatedAt: now,
        });
      } else {
        await appendPolicyPipelineLog(ctx, run.policyId, {
          timestamp: now,
          message: `Stale extraction lease detected; requeueing ${checkpoint.nextPhase ?? "pipeline"} phase`,
          phase: "watchdog",
          level: "warn",
        });
        await ctx.scheduler.runAfter(0, (internal as any).actions.policyExtraction.advance, {
          jobId: String(run.policyId),
        });
      }
      requeued.push(String(run.policyId));
    }

    return {
      scanned: runs.length,
      requeued,
      markedError,
      skipped,
      cutoff,
    };
  },
});

export const pipelineAcquireLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, leaseExpiresAt }) => {
    const run = await ensurePolicyExtractionRun(ctx, jobId as DataModelId<"policies">);
    if (!run || run.pipelineStatus !== "running" || !run.pipelineCheckpoint) {
      return null;
    }

    const checkpoint = run.pipelineCheckpoint as {
      nextPhase: string;
      state: unknown;
      createdAt: number;
      lease?: { id: string; phase: string; expiresAt: number; heartbeatAt?: number };
    };
    const now = Date.now();
    if (checkpoint.lease && checkpoint.lease.expiresAt > now) {
      const lastLogAt = run.pipelineLog?.at(-1)?.timestamp ?? checkpoint.createdAt;
      const heartbeatAt = checkpoint.lease.heartbeatAt;
      const staleLegacyLease =
        heartbeatAt === undefined && now - lastLogAt > PIPELINE_LEGACY_LEASE_STALE_MS;
      const staleHeartbeatLease =
        heartbeatAt !== undefined && now - heartbeatAt > PIPELINE_LEGACY_LEASE_STALE_MS;
      if (!staleLegacyLease && !staleHeartbeatLease) {
        return null;
      }
    }

    const leasedCheckpoint = {
      ...checkpoint,
      lease: {
        id: leaseId,
        phase: checkpoint.nextPhase,
        expiresAt: leaseExpiresAt,
        heartbeatAt: now,
      },
    };
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: leasedCheckpoint,
      updatedAt: now,
    });
    return leasedCheckpoint;
  },
});

export const pipelineSaveStateForLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    nextPhase: v.string(),
    state: v.any(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, nextPhase, state, leaseExpiresAt }) => {
    const run = await ensurePolicyExtractionRun(ctx, jobId as DataModelId<"policies">);
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
        createdAt: number;
          lease?: { id: string; phase: string; expiresAt: number; heartbeatAt?: number };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== leaseId) {
      return false;
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: {
        nextPhase,
        state,
        createdAt: now,
        lease: {
          id: leaseId,
          phase: nextPhase,
          expiresAt: leaseExpiresAt,
          heartbeatAt: now,
        },
      },
      updatedAt: now,
    });
    return true;
  },
});

export const pipelineExtendLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, leaseExpiresAt }) => {
    const run = await ensurePolicyExtractionRun(ctx, jobId as DataModelId<"policies">);
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
          createdAt: number;
          lease?: { id: string; phase: string; expiresAt: number; heartbeatAt?: number };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== leaseId) {
      return false;
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: {
        ...checkpoint,
        lease: {
          ...checkpoint.lease,
          expiresAt: leaseExpiresAt,
          heartbeatAt: now,
        },
      },
      updatedAt: now,
    });
    return true;
  },
});

export const pipelineCompleteLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    status: v.optional(
      v.union(
        v.literal("running"),
        v.literal("complete"),
        v.literal("error"),
      ),
    ),
    error: v.optional(v.union(v.string(), v.null())),
    checkpoint: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const policyId = args.jobId as DataModelId<"policies">;
    const run = await ensurePolicyExtractionRun(ctx, policyId);
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
          createdAt: number;
          lease?: { id: string; phase: string; expiresAt: number; heartbeatAt?: number };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== args.leaseId) {
      return false;
    }

    const patch: Record<string, unknown> = {};
    if ("checkpoint" in args) {
      patch.pipelineCheckpoint = args.checkpoint ?? undefined;
    }
    if (args.status) {
      patch.pipelineStatus = args.status;
      patch.pipelineError = args.error ?? undefined;
    }
    patch.updatedAt = Date.now();

    await ctx.db.patch(run._id, patch);
    if (args.status) {
      if (
        args.status === "complete" ||
        (args.status === "error" && args.error === "Cancelled by user")
      ) {
        await clearPolicyExtractionArtifacts(ctx, policyId);
      }
      await ctx.db.patch(policyId, {
        pipelineStatus: args.status,
        pipelineError: args.error ?? undefined,
        pipelineCheckpoint: undefined,
        pipelineLog: undefined,
      });
    }
    return true;
  },
});
