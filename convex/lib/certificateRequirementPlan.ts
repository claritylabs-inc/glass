import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const certificateRequirementSnapshotValidator = v.object({
  requirementId: v.id("insuranceRequirements"),
  title: v.string(),
  requirementText: v.string(),
  lineOfBusiness: v.optional(v.string()),
  limits: v.optional(v.array(v.object({
    kind: v.string(),
    amount: v.number(),
    label: v.optional(v.string()),
  }))),
  maxDeductible: v.optional(v.object({
    amount: v.number(),
    label: v.optional(v.string()),
  })),
  coverageForm: v.optional(v.union(v.literal("occurrence"), v.literal("claims_made"))),
  retroactiveDateOnOrBefore: v.optional(v.string()),
  provisions: v.optional(v.array(v.string())),
  requiredForms: v.optional(v.array(v.string())),
  sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
  sourceDocumentName: v.optional(v.string()),
  sourceExcerpt: v.optional(v.string()),
  updatedAt: v.number(),
});

export type CertificateRequirementSnapshot = {
  requirementId: Id<"insuranceRequirements">;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
  sourceDocumentId?: Id<"requirementSourceDocuments">;
  sourceDocumentName?: string;
  sourceExcerpt?: string;
  updatedAt: number;
};

export type CertificateRequirementPlanRow = {
  requirementId: Id<"insuranceRequirements">;
  status: "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
  matchedPolicyIds: Id<"policies">[];
  reasons: string[];
  summary?: string;
  snapshot: CertificateRequirementSnapshot;
};

export type CertificateRequirementPolicy = {
  policyId: Id<"policies">;
  final: boolean;
};

export type CertificateRequirementGap = {
  requirementId: Id<"insuranceRequirements">;
  title: string;
  status: CertificateRequirementPlanRow["status"] | "no_final_policy";
  reasons: string[];
  summary?: string;
};

export type CertificateGenerationTarget = {
  policyId: Id<"policies">;
  requirementIds: Id<"insuranceRequirements">[];
  requirementSnapshots: CertificateRequirementSnapshot[];
  requestedEndorsements: string[];
  includedLineOfBusinessCodes: string[];
};

export function buildCertificateRequirementPlan(args: {
  primaryPolicyId?: Id<"policies">;
  requirements: CertificateRequirementPlanRow[];
  policies: CertificateRequirementPolicy[];
}) {
  const policies = new Map(args.policies.map((policy) => [policy.policyId, policy]));
  const targets = new Map<Id<"policies">, CertificateGenerationTarget>();
  const ensureTarget = (policyId: Id<"policies">) => {
    const existing = targets.get(policyId);
    if (existing) return existing;
    const target: CertificateGenerationTarget = {
      policyId,
      requirementIds: [],
      requirementSnapshots: [],
      requestedEndorsements: [],
      includedLineOfBusinessCodes: [],
    };
    targets.set(policyId, target);
    return target;
  };
  if (args.primaryPolicyId) ensureTarget(args.primaryPolicyId);

  const gaps: CertificateRequirementGap[] = [];
  for (const requirement of args.requirements) {
    if (requirement.status !== "met" && requirement.status !== "expiring_soon") {
      gaps.push({
        requirementId: requirement.requirementId,
        title: requirement.snapshot.title,
        status: requirement.status,
        reasons: requirement.reasons,
        summary: requirement.summary,
      });
      continue;
    }

    const finalPolicyIds = requirement.matchedPolicyIds.filter(
      (policyId) => policies.get(policyId)?.final,
    );
    if (finalPolicyIds.length === 0) {
      gaps.push({
        requirementId: requirement.requirementId,
        title: requirement.snapshot.title,
        status: "no_final_policy",
        reasons: ["No fully extracted current policy supports this requirement."],
      });
      continue;
    }

    const policyId = finalPolicyIds[0];
    const target = ensureTarget(policyId);
    if (!target.requirementIds.includes(requirement.requirementId)) {
      target.requirementIds.push(requirement.requirementId);
      target.requirementSnapshots.push(requirement.snapshot);
    }
    if (
      requirement.snapshot.lineOfBusiness &&
      !target.includedLineOfBusinessCodes.includes(requirement.snapshot.lineOfBusiness)
    ) {
      target.includedLineOfBusinessCodes.push(requirement.snapshot.lineOfBusiness);
    }
    for (const provision of requirement.snapshot.provisions ?? []) {
      if (!target.requestedEndorsements.includes(provision)) {
        target.requestedEndorsements.push(provision);
      }
    }
  }

  return {
    targets: [...targets.values()].map((target) => ({
      ...target,
      requirementIds: [...target.requirementIds].sort(),
      requirementSnapshots: [...target.requirementSnapshots].sort((left, right) =>
        String(left.requirementId).localeCompare(String(right.requirementId)),
      ),
      requestedEndorsements: [...target.requestedEndorsements].sort(),
      includedLineOfBusinessCodes: [...target.includedLineOfBusinessCodes].sort(),
    })),
    gaps,
  };
}

export function certificateRequirementSignature(
  snapshots: CertificateRequirementSnapshot[] | undefined,
) {
  if (!snapshots?.length) return undefined;
  return snapshots
    .map((snapshot) => `${snapshot.requirementId}@${snapshot.updatedAt}`)
    .sort()
    .join(",");
}
