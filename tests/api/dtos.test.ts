import { describe, it, expect } from "vitest";
import {
  policyMatchesMcpFilters,
  policyMatchesSearch,
  quoteMatchesMcpFilters,
  toCertificateDto,
  toMcpPolicySummaryDto,
  toMcpQuoteSummaryDto,
  toNotificationDto,
  toOrgDto,
  toPolicyDto,
  toPolicyStatsDto,
} from "../../convex/lib/apiDto";

describe("toPolicyDto", () => {
  it("maps policy fields to snake_case", () => {
    const raw = {
      _id: "p1", _creationTime: 1000, carrier: "Zurich", policyNumber: "ZR-001",
      policyTypes: ["gl"], effectiveDate: "2024-01-01", expirationDate: "2025-01-01",
      premium: 5000, documentType: "policy",
    };
    const dto = toPolicyDto(raw);
    expect(dto.policy_number).toBe("ZR-001");
    expect(dto.policy_types).toEqual(["gl"]);
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
      policyTypes: ["general_liability"],
      policyYear: 2024,
      effectiveDate: "2024-01-01",
      expirationDate: "2025-01-01",
      premium: "$5,000",
      insuredName: "Acme",
      summary: "GL policy",
      isRenewal: false,
      coverages: [{ name: "GL" }],
    });
  });

  it("preserves existing MCP filter and search behavior", () => {
    expect(policyMatchesMcpFilters(policy, { carrier: "Zurich", year: "2024", type: "general_liability" })).toBe(true);
    expect(policyMatchesMcpFilters(policy, { carrier: "Chubb", year: "2024", type: "general_liability" })).toBe(false);
    expect(policyMatchesSearch(policy, "marsh")).toBe(true);
  });
});

describe("MCP quote DTO helpers", () => {
  it("maps quote summaries and filters by existing policyYear semantics", () => {
    const quote = {
      _id: "q1",
      carrier: "Chubb",
      policyTypes: ["cyber"],
      policyYear: 2024,
      quoteNumber: "Q-1",
      quoteYear: 2025,
      premium: "$8,000",
      insuredName: "Acme",
      isRenewal: true,
      coverages: [],
    };

    expect(quoteMatchesMcpFilters(quote, { carrier: "Chubb", year: "2024" })).toBe(true);
    expect(toMcpQuoteSummaryDto(quote)).toMatchObject({
      _id: "q1",
      quoteNumber: "Q-1",
      quoteYear: 2025,
      policyTypes: ["cyber"],
    });
  });
});

describe("toCertificateDto", () => {
  it("maps certificate summaries with legacy default metadata", () => {
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
      authority_type: "non_binding",
      certification_status: "not_applicable",
      certificate_parent_id: null,
      certificate_version_id: null,
      policy_version_id: null,
      lifecycle_status: null,
      version_number: null,
      reissue_reason: null,
      url: null,
    });
  });

  it("maps certificate lifecycle metadata when newer surfaces provide it", () => {
    const dto = toCertificateDto({
      _id: "c1",
      policyId: "p1",
      fileId: "f1",
      fileName: "coi.pdf",
      createdAt: 123,
      certificateParentId: "cp1",
      certificateVersionId: "cv2",
      policyVersionId: "pv3",
      lifecycleStatus: "issued",
      versionNumber: 2,
      reissueReason: "renewal",
    });

    expect(dto).toMatchObject({
      certificate_parent_id: "cp1",
      certificate_version_id: "cv2",
      policy_version_id: "pv3",
      lifecycle_status: "issued",
      version_number: 2,
      reissue_reason: "renewal",
    });
  });
});

describe("toPolicyStatsDto", () => {
  it("computes policy counts by type, carrier, and year", () => {
    expect(toPolicyStatsDto([
      { carrier: "Zurich", policyTypes: ["gl", "auto"], policyYear: 2024 },
      { carrier: "Zurich", policyTypes: ["gl"], policyYear: 2025 },
    ])).toEqual({
      totalPolicies: 2,
      byType: { gl: 2, auto: 1 },
      byCarrier: { Zurich: 2 },
      byYear: { "2024": 1, "2025": 1 },
    });
  });
});
