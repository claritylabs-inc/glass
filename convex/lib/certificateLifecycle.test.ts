import { describe, expect, it } from "vitest";
import {
  buildRenewalReviewJobs,
  lifecycleKey,
  planCertificateGeneration,
  resolveCertificateWorkflowSettings,
  resolveHeldCertificateRequests,
  type CertificateParentRecord,
  type CertificateVersionRecord,
} from "./certificateLifecycle";

const parent: CertificateParentRecord = {
  _id: "cert_parent_1",
  orgId: "org_1",
  policyId: "policy_1",
  certificateHolderId: "holder_1",
  status: "active",
  latestVersionId: "cert_version_2",
};

const versions: CertificateVersionRecord[] = [
  {
    _id: "cert_version_1",
    certificateId: "cert_parent_1",
    policyVersionId: "policy_version_1",
    versionNumber: 1,
    status: "superseded",
  },
  {
    _id: "cert_version_2",
    certificateId: "cert_parent_1",
    policyVersionId: "policy_version_2",
    versionNumber: 2,
    status: "issued",
  },
];

describe("certificate lifecycle helpers", () => {
  it("dedupes one active certificate parent per org, policy, and holder", () => {
    expect(lifecycleKey({ orgId: "org_1", policyId: "policy_1", certificateHolderId: "holder_1" })).toBe(
      "org_1:policy_1:holder_1",
    );

    expect(
      planCertificateGeneration({
        parents: [parent],
        versions,
        orgId: "org_1",
        policyId: "policy_1",
        certificateHolderId: "holder_1",
        currentPolicyVersionId: "policy_version_2",
      }),
    ).toEqual({
      kind: "reuse_latest",
      certificateId: "cert_parent_1",
      versionId: "cert_version_2",
    });
  });

  it("creates a reissue version instead of duplicating the certificate parent", () => {
    expect(
      planCertificateGeneration({
        parents: [parent],
        versions,
        orgId: "org_1",
        policyId: "policy_1",
        certificateHolderId: "holder_1",
        currentPolicyVersionId: "policy_version_2",
        explicitReissue: true,
      }),
    ).toEqual({
      kind: "reissue",
      certificateId: "cert_parent_1",
      policyVersionId: "policy_version_2",
      nextVersionNumber: 3,
    });
  });

  it("starts certificate issuance at the current policy version for a new holder", () => {
    expect(
      planCertificateGeneration({
        parents: [parent],
        versions,
        orgId: "org_1",
        policyId: "policy_1",
        certificateHolderId: "holder_2",
        currentPolicyVersionId: "policy_version_2",
      }),
    ).toEqual({
      kind: "create_parent_and_issue",
      policyVersionId: "policy_version_2",
      nextVersionNumber: 1,
    });
  });

  it("creates renewal review jobs only for active issued certificate parents", () => {
    const jobs = buildRenewalReviewJobs({
      parents: [
        parent,
        { ...parent, _id: "archived", status: "archived" },
        { ...parent, _id: "draft", latestVersionId: "draft_version" },
      ],
      versions: [
        ...versions,
        {
          _id: "draft_version",
          certificateId: "draft",
          policyVersionId: "policy_version_2",
          versionNumber: 1,
          status: "draft_review",
        },
      ],
      existingJobs: [],
      renewalPolicyVersionId: "policy_version_3",
    });

    expect(jobs).toEqual([
      {
        certificateId: "cert_parent_1",
        policyVersionId: "policy_version_3",
        reason: "renewal",
      },
    ]);
  });

  it("does not duplicate an open renewal review job for the same policy version", () => {
    expect(
      buildRenewalReviewJobs({
        parents: [parent],
        versions,
        existingJobs: [
          {
            _id: "job_1",
            certificateId: "cert_parent_1",
            policyVersionId: "policy_version_3",
            reason: "renewal",
            status: "open",
          },
        ],
        renewalPolicyVersionId: "policy_version_3",
      }),
    ).toEqual([]);
  });

  it("resolves held requests linked to completed policy change cases", () => {
    expect(
      resolveHeldCertificateRequests({
        policyChangeCaseId: "case_1",
        holds: [
          { _id: "hold_1", policyChangeCaseId: "case_1", status: "held" },
          { _id: "hold_2", policyChangeCaseId: "case_1", status: "policy_change_opened" },
          { _id: "hold_3", policyChangeCaseId: "case_2", status: "held" },
          { _id: "hold_4", policyChangeCaseId: "case_1", status: "cancelled" },
        ],
      }),
    ).toEqual([
      { _id: "hold_1", policyChangeCaseId: "case_1", status: "resolved" },
      { _id: "hold_2", policyChangeCaseId: "case_1", status: "resolved" },
      { _id: "hold_3", policyChangeCaseId: "case_2", status: "held" },
      { _id: "hold_4", policyChangeCaseId: "case_1", status: "cancelled" },
    ]);
  });

  it("inherits broker certificate settings with explicit client overrides", () => {
    expect(
      resolveCertificateWorkflowSettings({
        brokerDefaults: {
          autoCreateRenewalReviews: true,
          requireCertificateReview: true,
          allowClientReissue: false,
          defaultDeliveryMode: "draft",
        },
        clientOverrides: {
          requireCertificateReview: false,
          allowClientReissue: true,
        },
      }),
    ).toEqual({
      autoCreateRenewalReviews: true,
      requireCertificateReview: false,
      allowClientReissue: true,
      defaultDeliveryMode: "draft",
    });
  });
});
