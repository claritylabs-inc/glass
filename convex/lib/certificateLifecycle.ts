export type LifecycleId = string;

export type CertificateLifecycleStatus = "active" | "archived";
export type CertificateVersionStatus =
  | "draft_review"
  | "issued"
  | "superseded"
  | "held";

export interface CertificateParentRecord {
  _id: LifecycleId;
  orgId: LifecycleId;
  policyId: LifecycleId;
  certificateHolderId: LifecycleId;
  status: CertificateLifecycleStatus;
  latestVersionId?: LifecycleId;
}

export interface CertificateVersionRecord {
  _id: LifecycleId;
  certificateId: LifecycleId;
  policyVersionId: LifecycleId;
  versionNumber: number;
  status: CertificateVersionStatus;
  fileId?: LifecycleId;
  issuedAt?: number;
}

export interface CertificateReviewJobRecord {
  _id: LifecycleId;
  certificateId: LifecycleId;
  policyVersionId: LifecycleId;
  status: "open" | "completed" | "cancelled";
  reason: "renewal" | "post_endorsement";
}

export interface HeldCertificateRequestRecord {
  _id: LifecycleId;
  policyChangeCaseId?: LifecycleId;
  status: "held" | "policy_change_opened" | "resolved" | "cancelled";
}

export interface CertificateWorkflowSettings {
  autoCreateRenewalReviews: boolean;
  requireCertificateReview: boolean;
  allowClientReissue: boolean;
  defaultDeliveryMode: "draft" | "send";
}

export type CertificateWorkflowSettingsOverride = Partial<CertificateWorkflowSettings>;

export type CertificateGenerationPlan =
  | {
      kind: "reuse_latest";
      certificateId: LifecycleId;
      versionId: LifecycleId;
    }
  | {
      kind: "reissue";
      certificateId: LifecycleId;
      policyVersionId: LifecycleId;
      nextVersionNumber: number;
    }
  | {
      kind: "create_parent_and_issue";
      policyVersionId: LifecycleId;
      nextVersionNumber: 1;
    };

export function lifecycleKey(parts: {
  orgId: LifecycleId;
  policyId: LifecycleId;
  certificateHolderId: LifecycleId;
}): string {
  return [parts.orgId, parts.policyId, parts.certificateHolderId].join(":");
}

export function findActiveCertificateParent(params: {
  parents: CertificateParentRecord[];
  orgId: LifecycleId;
  policyId: LifecycleId;
  certificateHolderId: LifecycleId;
}): CertificateParentRecord | undefined {
  return params.parents.find(
    (parent) =>
      parent.status === "active" &&
      parent.orgId === params.orgId &&
      parent.policyId === params.policyId &&
      parent.certificateHolderId === params.certificateHolderId,
  );
}

export function nextCertificateVersionNumber(params: {
  certificateId: LifecycleId;
  versions: CertificateVersionRecord[];
}): number {
  const highest = params.versions
    .filter((version) => version.certificateId === params.certificateId)
    .reduce((max, version) => Math.max(max, version.versionNumber), 0);
  return highest + 1;
}

export function planCertificateGeneration(params: {
  parents: CertificateParentRecord[];
  versions: CertificateVersionRecord[];
  orgId: LifecycleId;
  policyId: LifecycleId;
  certificateHolderId: LifecycleId;
  currentPolicyVersionId: LifecycleId;
  explicitReissue?: boolean;
}): CertificateGenerationPlan {
  const parent = findActiveCertificateParent(params);
  if (!parent) {
    return {
      kind: "create_parent_and_issue",
      policyVersionId: params.currentPolicyVersionId,
      nextVersionNumber: 1,
    };
  }

  const latestVersion = params.versions.find(
    (version) => version._id === parent.latestVersionId,
  );
  if (
    latestVersion &&
    latestVersion.policyVersionId === params.currentPolicyVersionId &&
    latestVersion.status === "issued" &&
    !params.explicitReissue
  ) {
    return {
      kind: "reuse_latest",
      certificateId: parent._id,
      versionId: latestVersion._id,
    };
  }

  return {
    kind: "reissue",
    certificateId: parent._id,
    policyVersionId: params.currentPolicyVersionId,
    nextVersionNumber: nextCertificateVersionNumber({
      certificateId: parent._id,
      versions: params.versions,
    }),
  };
}

export function buildRenewalReviewJobs(params: {
  parents: CertificateParentRecord[];
  versions: CertificateVersionRecord[];
  existingJobs: CertificateReviewJobRecord[];
  renewalPolicyVersionId: LifecycleId;
}): Array<Omit<CertificateReviewJobRecord, "_id" | "status">> {
  return params.parents.flatMap((parent) => {
    if (parent.status !== "active" || !parent.latestVersionId) return [];
    const latestVersion = params.versions.find(
      (version) => version._id === parent.latestVersionId,
    );
    if (!latestVersion || latestVersion.status !== "issued") return [];

    const alreadyOpen = params.existingJobs.some(
      (job) =>
        job.certificateId === parent._id &&
        job.policyVersionId === params.renewalPolicyVersionId &&
        job.reason === "renewal" &&
        job.status === "open",
    );
    if (alreadyOpen) return [];

    return [{
      certificateId: parent._id,
      policyVersionId: params.renewalPolicyVersionId,
      reason: "renewal" as const,
    }];
  });
}

export function resolveHeldCertificateRequests(params: {
  holds: HeldCertificateRequestRecord[];
  policyChangeCaseId: LifecycleId;
}): HeldCertificateRequestRecord[] {
  return params.holds.map((hold) => {
    if (
      hold.policyChangeCaseId !== params.policyChangeCaseId ||
      (hold.status !== "held" && hold.status !== "policy_change_opened")
    ) {
      return hold;
    }
    return { ...hold, status: "resolved" };
  });
}

export function resolveCertificateWorkflowSettings(params: {
  brokerDefaults: CertificateWorkflowSettings;
  clientOverrides?: CertificateWorkflowSettingsOverride | null;
}): CertificateWorkflowSettings {
  const overrides = params.clientOverrides ?? {};
  return {
    autoCreateRenewalReviews:
      overrides.autoCreateRenewalReviews ??
      params.brokerDefaults.autoCreateRenewalReviews,
    requireCertificateReview:
      overrides.requireCertificateReview ??
      params.brokerDefaults.requireCertificateReview,
    allowClientReissue:
      overrides.allowClientReissue ?? params.brokerDefaults.allowClientReissue,
    defaultDeliveryMode:
      overrides.defaultDeliveryMode ?? params.brokerDefaults.defaultDeliveryMode,
  };
}
