import {
  readCarrierIdentity,
  sameCarrierIdentityName,
  type CarrierIdentity,
} from "./carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./carrierIdentityEnrichment";
import {
  buildCarrierIdentityFromSourceEvidence,
  preserveCurrentCarrierBranding,
  sourceCarrierIdentityUnchanged,
  sourceNodeFromStoredSource,
  sourceSpanLikeFromStoredSource,
  type CarrierSourceNode,
} from "./carrierIdentitySource";

export type CarrierIdentityBackfillOutcome =
  | "pending"
  | "rebuilt"
  | "unchanged"
  | "skipped"
  | "failed";

export type CarrierIdentityBackfillResult = {
  outcome: CarrierIdentityBackfillOutcome;
  reason?: string;
  patch?: Record<string, unknown>;
  shouldEnrich: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function insurerAddress(value: unknown) {
  const address = record(value);
  const normalized = {
    street1: text(address.street1),
    street2: text(address.street2),
    city: text(address.city),
    state: text(address.state),
    zip: text(address.zip),
    country: text(address.country),
    formatted: text(address.formatted),
  };
  if (!Object.values(normalized).some(Boolean)) return undefined;
  return Object.fromEntries(
    Object.entries(normalized).filter((entry) => entry[1] !== undefined),
  );
}

function stableHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function carrierIdentityBackfillSkipReason(policy: {
  deletedAt?: number;
  pipelineStatus?: string;
  extractionDataStage?: "placeholder" | "preview" | "final";
}) {
  if (policy.deletedAt !== undefined) return "archived_policy";
  if (policy.pipelineStatus === "error") return "failed_extraction";
  const stage =
    policy.extractionDataStage ??
    (policy.pipelineStatus === "complete" ? "final" : "placeholder");
  return stage === "final" ? undefined : "not_final_policy";
}

export function carrierIdentityBackfillPolicyFingerprint(
  policy: Record<string, unknown>,
) {
  const serialized = JSON.stringify({
    fileId: policy.fileId,
    extractionDataStage: policy.extractionDataStage,
    extractionDataStageUpdatedAt: policy.extractionDataStageUpdatedAt,
    pipelineStatus: policy.pipelineStatus,
    deletedAt: policy.deletedAt,
    operationalProfile: policy.operationalProfile,
    carrierIdentity: policy.carrierIdentity,
    carrier: policy.carrier,
    carrierLegalName: policy.carrierLegalName,
    security: policy.security,
    insurer: policy.insurer,
    generalAgent: policy.generalAgent,
    mga: policy.mga,
  });
  return `${stableHash(serialized)}${stableHash(`carrier:${serialized}`)}`;
}

function brandingIsCurrent(identity: CarrierIdentity | undefined) {
  return identity?.branding?.enrichmentVersion ===
    CARRIER_IDENTITY_ENRICHMENT_VERSION;
}

export function rebuildCarrierIdentityFromStoredSources(params: {
  policyId: string;
  policy: Record<string, unknown>;
  sourceSpans: Array<Record<string, unknown>>;
  sourceNodes: Array<Record<string, unknown>>;
}): CarrierIdentityBackfillResult {
  if (params.sourceSpans.length === 0) {
    return {
      outcome: "skipped",
      reason: "missing_source_spans",
      shouldEnrich: false,
    };
  }
  if (
    !params.policy.operationalProfile ||
    typeof params.policy.operationalProfile !== "object" ||
    Array.isArray(params.policy.operationalProfile)
  ) {
    return {
      outcome: "skipped",
      reason: "missing_operational_profile",
      shouldEnrich: false,
    };
  }

  try {
    const sourceSpans = params.sourceSpans.map((span) =>
      sourceSpanLikeFromStoredSource(span, params.policyId)
    );
    const storedSourceTree = params.sourceNodes
      .map((node) => sourceNodeFromStoredSource(node, params.policyId))
      .filter(
        (node): node is CarrierSourceNode & Record<string, unknown> =>
          Boolean(node),
      );
    const rebuilt = buildCarrierIdentityFromSourceEvidence({
      operationalProfile: params.policy.operationalProfile,
      sourceTree: storedSourceTree,
      sourceSpans,
    });
    if (!rebuilt) {
      return {
        outcome: "skipped",
        reason: "insufficient_source_identity",
        shouldEnrich: false,
      };
    }

    const existing = readCarrierIdentity(params.policy.carrierIdentity);
    const unchanged = sourceCarrierIdentityUnchanged(existing, rebuilt);
    const carrierIdentity = preserveCurrentCarrierBranding(rebuilt, existing);
    const primaryLegalEntity = carrierIdentity.legalEntities[0];
    const currentInsurer = record(params.policy.insurer);
    const currentGeneralAgent = record(params.policy.generalAgent);
    const profile = record(params.policy.operationalProfile);
    const sourceParties = Array.isArray(profile.parties)
      ? profile.parties.map(record)
      : [];
    const primarySourceParty = primaryLegalEntity
      ? sourceParties.find((party) => {
          const role = text(party.role)?.toLowerCase();
          const hasProvenance =
            (Array.isArray(party.sourceNodeIds) &&
              party.sourceNodeIds.length > 0) ||
            (Array.isArray(party.sourceSpanIds) &&
              party.sourceSpanIds.length > 0);
          return (
            (role === "carrier" || role === "insurer") &&
            hasProvenance &&
            sameCarrierIdentityName(party.name, primaryLegalEntity.name)
          );
        })
      : undefined;
    const currentInsurerMatches = primaryLegalEntity
      ? sameCarrierIdentityName(
          currentInsurer.legalName,
          primaryLegalEntity.name,
        )
      : false;
    const sourceNaicNumber = text(primarySourceParty?.naicNumber);
    const sourceAddress = insurerAddress(primarySourceParty?.address);
    const hasCurrentBranding = brandingIsCurrent(carrierIdentity);
    const patch: Record<string, unknown> = {
      carrier: carrierIdentity.displayName,
      carrierIdentity,
      carrierLegalName: primaryLegalEntity?.name,
      security:
        carrierIdentity.legalEntities.length === 1
          ? primaryLegalEntity?.name
          : undefined,
      carrierIdentityEnrichmentStatus: hasCurrentBranding
        ? "ready"
        : undefined,
      carrierIdentityEnrichmentAttempts: hasCurrentBranding
        ? params.policy.carrierIdentityEnrichmentAttempts
        : undefined,
      carrierIdentityEnrichmentAttemptedAt: hasCurrentBranding
        ? params.policy.carrierIdentityEnrichmentAttemptedAt
        : undefined,
      carrierBrandId: undefined,
      carrierBrandStatus: undefined,
      carrierBrandAttempts: undefined,
      carrierBrandAttemptedAt: undefined,
      carrierNaicNumber:
        sourceNaicNumber ??
        (currentInsurerMatches
          ? text(params.policy.carrierNaicNumber)
          : undefined),
      carrierAmBestRating: currentInsurerMatches
        ? params.policy.carrierAmBestRating
        : undefined,
      carrierAdmittedStatus: currentInsurerMatches
        ? params.policy.carrierAdmittedStatus
        : undefined,
    };
    if (primaryLegalEntity) {
      patch.insurer = {
        ...(currentInsurerMatches ? currentInsurer : {}),
        legalName: primaryLegalEntity.name,
        ...(sourceNaicNumber ? { naicNumber: sourceNaicNumber } : {}),
        ...(sourceAddress ? { address: sourceAddress } : {}),
        documentNodeId: primaryLegalEntity.sourceNodeIds[0],
        sourceSpanIds: primaryLegalEntity.sourceSpanIds,
      };
    }
    if (
      carrierIdentity.operatingName &&
      sameCarrierIdentityName(
        currentGeneralAgent.agencyName,
        carrierIdentity.operatingName,
      )
    ) {
      patch.generalAgent = undefined;
      patch.mga = undefined;
    }

    return {
      outcome: unchanged ? "unchanged" : "rebuilt",
      patch,
      shouldEnrich: !hasCurrentBranding,
    };
  } catch (error) {
    return {
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
      shouldEnrich: false,
    };
  }
}
