import { describe, it, expect } from "vitest";
import {
  policyMatchesMcpFilters,
  policyMatchesSearch,
  toCertificateHolderDto,
  toCertificateDto,
  toCertificateVersionDto,
  toCertificateWorkflowJobDto,
  toMcpPolicySummaryDto,
  toNotificationDto,
  toOrgDto,
  toPolicyDto,
  toPolicyStatsDto,
  toPolicyVersionDto,
} from "../../convex/lib/apiDto";

describe("toPolicyDto", () => {
  it("maps policy fields to snake_case", () => {
    const raw = {
      _id: "p1", _creationTime: 1000, carrier: "Zurich", policyNumber: "ZR-001",
      policyTypes: ["general_liability"], effectiveDate: "2024-01-01", expirationDate: "2025-01-01",
      premium: 5000, documentType: "policy",
    };
    const dto = toPolicyDto(raw);
    expect(dto.policy_number).toBe("ZR-001");
    expect(dto.lines_of_business).toEqual(["CGL"]);
    expect(dto.policy_types).toEqual(["CGL"]);
    expect(dto.created_at).toBe(1000);
  });
});

describe("toOrgDto", () => {
  it("maps org fields", () => {
    const raw = { _id: "org1", _creationTime: 100, name: "Acme", industry: "tech" };
    const dto = toOrgDto(raw);
    expect(dto.id).toBe("org1");
    expect(dto.name).toBe("Acme");
    expect(dto.created_at).toBe(100);
    expect(dto.industry).toBe("tech");
  });
});

describe("toNotificationDto", () => {
  it("maps notification fields", () => {
    const raw = { _id: "n1", _creationTime: 300, type: "policy_expiring", message: "Policy expiring", read: false };
    const dto = toNotificationDto(raw);
    expect(dto.id).toBe("n1");
    expect(dto.type).toBe("policy_expiring");
    expect(dto.read).toBe(false);
  });
});

describe("MCP policy DTO helpers", () => {
  const policy = {
    _id: "p1",
    carrier: "Zurich",
    security: "Zurich NA",
    broker: "Marsh",
    policyNumber: "ZR-001",
    policyTypes: ["general_liability"],
    policyYear: 2024,
    effectiveDate: "2024-01-01",
    expirationDate: "2025-01-01",
    premium: "$5,000",
    insuredName: "Acme",
    summary: "GL policy",
    isRenewal: false,
    coverages: [{ name: "GL" }],
  };

  it("maps the MCP list summary without changing field names", () => {
    expect(toMcpPolicySummaryDto(policy)).toEqual({
      _id: "p1",
      carrier: "Zurich",
      security: "Zurich NA",
      broker: "Marsh",
      policyNumber: "ZR-001",
      policyTypes: ["CGL"],
      policyYear: 2024,
      effectiveDate: "2024-01-01",
      expirationDate: "2025-01-01",
      premium: "$5,000",
      insuredName: "Acme",
      summary: "GL policy",
      isRenewal: false,
      coverages: [{ name: "GL" }],
      pipelineStatus: undefined,
      extractionDataStage: undefined,
      provisional: false,
    });
  });

  it("preserves existing MCP filter and search behavior", () => {
    expect(policyMatchesMcpFilters(policy, { carrier: "Zurich", year: "2024", type: "CGL" })).toBe(true);
    expect(policyMatchesMcpFilters(policy, { carrier: "Zurich", year: "2024", type: "Commercial General Liability" })).toBe(true);
    expect(policyMatchesMcpFilters(policy, { carrier: "Zurich", year: "2024", type: "general_liability" })).toBe(true);
    expect(policyMatchesMcpFilters(policy, { carrier: "Chubb", year: "2024", type: "CGL" })).toBe(false);
    expect(policyMatchesSearch(policy, "marsh")).toBe(true);
  });
});

describe("toCertificateDto", () => {
  it("maps certificate summaries with request metadata", () => {
    const dto = toCertificateDto({
      _id: "c1",
      policyId: "p1",
      fileId: "f1",
      fileName: "coi.pdf",
      createdAt: 123,
    });

    expect(dto).toMatchObject({
      id: "c1",
      policy_id: "p1",
      file_id: "f1",
      request_kind: "holder",
      additional_insured_name: null,
      url: null,
    });
  });

  it("keeps lifecycle identity out of legacy certificate DTOs", () => {
    const legacyCertificate = {
      _id: "legacy-c1",
      policyId: "p1",
      fileId: "f1",
      fileName: "coi.pdf",
      createdAt: 123,
      holderId: "holder-1",
      policyCertificateId: "pc-1",
      certificateVersionId: "cv-2",
      certificateVersionNumber: 2,
      policyVersionId: "pv-3",
      url: "https://example.com/coi.pdf",
    };

    const dto = toCertificateDto(legacyCertificate);

    expect(dto).not.toHaveProperty("holder_id");
    expect(dto).not.toHaveProperty("policy_certificate_id");
    expect(dto).not.toHaveProperty("certificate_version_id");
    expect(dto).not.toHaveProperty("certificate_version_number");
    expect(dto).not.toHaveProperty("policy_version_id");
    expect(dto.url).toBe("https://example.com/coi.pdf");
  });
});

describe("certificate lifecycle DTOs", () => {
  it("maps certificate holder records", () => {
    expect(toCertificateHolderDto({
      _id: "holder-1",
      orgId: "org-1",
      displayName: "Acme PM",
      email: "ops@example.com",
      address: { line1: "1 Main", city: "Austin", state: "TX" },
      normalizedName: "acme pm",
      source: "extraction",
      createdAt: 100,
      updatedAt: 200,
    })).toMatchObject({
      id: "holder-1",
      display_name: "Acme PM",
      email: "ops@example.com",
      address: { line1: "1 Main", city: "Austin", state: "TX" },
      source: "extraction",
      created_at: 100,
      updated_at: 200,
    });
  });

  it("maps policy versions with current version fields", () => {
    expect(toPolicyVersionDto({
      _id: "pv-1",
      orgId: "org-1",
      policyId: "p1",
      versionNumber: 2,
      versionKind: "renewal",
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      policyNumber: "POL-2",
      fieldDiffs: [{ field: "expirationDate" }],
      summary: "Renewal version",
      createdAt: 300,
    })).toMatchObject({
      id: "pv-1",
      policy_id: "p1",
      version_number: 2,
      version_kind: "renewal",
      field_diffs: [{ field: "expirationDate" }],
      summary: "Renewal version",
    });
  });

  it("maps certificate versions and workflow jobs", () => {
    const holder = {
      _id: "holder-1",
      orgId: "org-1",
      displayName: "Acme PM",
      createdAt: 100,
      updatedAt: 200,
    };
    const version = {
      _id: "cv-1",
      orgId: "org-1",
      certificateId: "pc-1",
      holderId: "holder-1",
      policyId: "p1",
      policyVersionId: "pv-1",
      versionNumber: 3,
      status: "issued",
      fileId: "file-1",
      fileName: "coi.pdf",
      source: "api",
      createdAt: 300,
      updatedAt: 400,
      holder,
      url: "https://example.com/coi.pdf",
    };

    expect(toCertificateVersionDto(version)).toMatchObject({
      id: "cv-1",
      certificate_id: "pc-1",
      policy_certificate_id: "pc-1",
      holder_id: "holder-1",
      policy_version_id: "pv-1",
      version_number: 3,
      holder: { id: "holder-1", display_name: "Acme PM" },
      url: "https://example.com/coi.pdf",
    });

    expect(toCertificateWorkflowJobDto({
      _id: "job-1",
      orgId: "org-1",
      certificateId: "pc-1",
      certificateVersionId: "cv-1",
      holderId: "holder-1",
      policyId: "p1",
      policyVersionId: "pv-1",
      kind: "renewal_reissue",
      status: "review_required",
      recipientEmail: "ops@example.com",
      createdAt: 500,
      updatedAt: 600,
      holder,
      certificateVersion: version,
    })).toMatchObject({
      id: "job-1",
      certificate_id: "pc-1",
      policy_certificate_id: "pc-1",
      kind: "renewal_reissue",
      status: "review_required",
      recipient_email: "ops@example.com",
      holder: { id: "holder-1", display_name: "Acme PM" },
      certificate_version: { id: "cv-1", version_number: 3 },
    });
  });
});

describe("toPolicyStatsDto", () => {
  it("computes policy counts by type, carrier, and year", () => {
    expect(toPolicyStatsDto([
      { carrier: "Zurich", policyTypes: ["general_liability", "auto"], policyYear: 2024 },
      { carrier: "Zurich", policyTypes: ["general_liability"], policyYear: 2025 },
    ])).toEqual({
      totalPolicies: 2,
      byType: { CGL: 2, AUTOB: 1 },
      byCarrier: { Zurich: 2 },
      byYear: { "2024": 1, "2025": 1 },
    });
  });
});
