import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import {
  requireBrokerAccessToClient,
  assertCanUploadPolicy,
  assertCanDeletePolicy,
  assertCanReadPolicy,
} from "./lib/access";
import { recordBrokerActivity } from "./lib/brokerActivity";
import type { Id as DataModelId } from "./_generated/dataModel";

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
        p.extractionStatus === "complete" &&
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
        p.extractionStatus === "complete" &&
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

    const quotes = allPolicies.filter((p) => p.documentType === "quote" && p.extractionStatus === "complete" && !p.deletedAt);
    const pendingExtractions = allPolicies.filter(
      (p) =>
        p.documentType === "quote" &&
        !p.deletedAt &&
        (p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error")
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
        (p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "paused" ||
        p.extractionStatus === "error")
    );

    const enriched = await Promise.all(
      pending.map(async (p) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (p.emailId) {
          const email = await ctx.db.get(p.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
        return {
          ...rest,
          emailSubject,
          emailFrom,
          hasRawResponse: !!rawExtractionResponse,
          hasRawMetadata: !!rawMetadataResponse,
        };
      })
    );

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
        (p.extractionStatus === "complete" || p.extractionStatus === "not_insurance")
    );

    const enriched = await Promise.all(
      completed.map(async (p) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (p.emailId) {
          const email = await ctx.db.get(p.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
        return {
          ...rest,
          emailSubject,
          emailFrom,
          hasRawResponse: !!rawExtractionResponse,
          hasRawMetadata: !!rawMetadataResponse,
        };
      })
    );

    return enriched;
  },
});

export const get = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) return null;
    return {
      ...policy,
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

export const emailIdsWithPolicies = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const ids = new Set<string>();
    for (const p of all) {
      if (
        p.emailId &&
        p.extractionStatus !== "not_insurance" &&
        !p.deletedAt
      ) {
        ids.add(p.emailId);
      }
    }
    return [...ids];
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
      (p) => p.extractionStatus === "complete" && !p.deletedAt
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
      (p) => p.documentType === "quote" && p.extractionStatus === "complete" && !p.deletedAt
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
      (p) => p.extractionStatus === "complete" && !p.deletedAt
    );
  },
});

// Internal version for scheduled actions (no auth context)
export const emailIdsWithPoliciesInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    const ids = new Set<string>();
    for (const p of all) {
      if (p.emailId && p.extractionStatus !== "not_insurance" && !p.deletedAt) {
        ids.add(p.emailId);
      }
    }
    return [...ids];
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
    const connections = await ctx.db
      .query("emailConnections")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();

    const policies = allPolicies.filter((p) => p.extractionStatus === "complete" && !p.deletedAt);
    const pendingExtractions = allPolicies.filter(
      (p) =>
        !p.deletedAt &&
        (p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error")
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

    const lastScan = connections.reduce<number | null>((latest, c) => {
      if (!c.lastScanAt) return latest;
      return latest ? Math.max(latest, c.lastScanAt) : c.lastScanAt;
    }, null);

    return {
      totalPolicies: policies.length,
      activeConnections: connections.length,
      lastScanAt: lastScan,
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
  limit: v.optional(v.string()),
  limitType: v.optional(v.string()),
  limitValueType: v.optional(v.string()),
  deductible: v.optional(v.string()),
  deductibleValueType: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  pageNumber: v.optional(v.number()),
  sectionRef: v.optional(v.string()),
  originalContent: v.optional(v.string()),
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
    emailId: v.optional(v.id("emails")),
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
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("not_insurance")
    ),
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
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    document: v.optional(documentValidator),
    extractionStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("extracting"),
        v.literal("paused"),
        v.literal("complete"),
        v.literal("error"),
        v.literal("not_insurance")
      )
    ),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    extractionCheckpoint: v.optional(v.any()),
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
    premiumBreakdown: v.optional(v.any()),
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
    if ((fields as { extractionStatus?: string }).extractionStatus === "complete") {
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
      extractionStatus: "pending",
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
    const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
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
    return all.filter(
      (p) =>
        p.extractionStatus !== "not_insurance" &&
        !p.deletedAt &&
        (!args.documentType || p.documentType === args.documentType),
    );
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
    await ctx.db.patch(args.id, { extractionStatus: "not_insurance" as const });
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
    if (policy.extractionStatus !== "extracting") throw new Error("Can only pause extracting policies");
    await ctx.db.patch(args.id, { extractionStatus: "paused" });
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
    if (policy.extractionStatus !== "paused") throw new Error("Can only resume paused policies");
    await ctx.db.patch(args.id, { extractionStatus: "extracting" });
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
    // Allow cancel from any non-complete status
    const cancelable = ["pending", "extracting", "paused", "error"];
    if (!cancelable.includes(policy.extractionStatus)) {
      throw new Error("Cannot cancel a completed extraction");
    }
    await ctx.db.patch(args.id, { extractionStatus: "not_insurance" as const, extractionError: "Cancelled by user" });
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
    await ctx.db.patch(args.id, {
      extractionStatus: "pending",
      extractionError: undefined,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      insuredName: "Extracting...",
      summary: undefined,
      coverages: [],
      rawExtractionResponse: undefined,
      rawMetadataResponse: undefined,
      document: undefined,
      metadataSource: undefined,
      extractionLog: undefined,
    });

    // Schedule fresh extraction — use stored file if available, fall back to IMAP
    if (policy.fileId) {
      await ctx.scheduler.runAfter(0, api.actions.retryExtraction.retryExtraction, {
        policyId: args.id,
        mode: "full" as const,
      });
    } else if (policy.emailId) {
      const email = await ctx.db.get(policy.emailId);
      if (email) {
        await ctx.scheduler.runAfter(0, internal.actions.extractPolicy.extractPolicy, {
          emailId: policy.emailId,
          connectionId: email.connectionId,
          userId,
          orgId,
        });
      }
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
    const log = policy.extractionLog ?? [];
    log.push({ timestamp: Date.now(), message: args.message });
    await ctx.db.patch(args.id, { extractionLog: log });
  },
});

export const clearExtractionLog = internalMutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { extractionLog: [] });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
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
    emailIds: v.optional(v.array(v.id("emails"))),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    // Strip undefined values so we don't accidentally unset fields
    const patch: Record<string, any> = {};
    if (fields.files !== undefined) patch.files = fields.files;
    if (fields.reconciliationStatus !== undefined) patch.reconciliationStatus = fields.reconciliationStatus;
    if (fields.emailIds !== undefined) patch.emailIds = fields.emailIds;
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

    // Delete associated intelligence entries (sourceRef = policyId)
    const intel = await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    for (const entry of intel) {
      if (entry.sourceRef === args.id) {
        await ctx.db.delete(entry._id);
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const listForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    return ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(100);
  },
});
