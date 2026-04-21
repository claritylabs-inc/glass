import { describe, it, expect } from "vitest";
import { toPolicyDto, toPassportDto, toOrgDto, toNotificationDto, toApplicationDto } from "../../convex/lib/apiDto";

describe("toPolicyDto", () => {
  it("strips raw blobs and uses snake_case", () => {
    const raw = {
      _id: "p1", _creationTime: 1000, carrier: "Zurich", policyNumber: "ZR-001",
      policyTypes: ["gl"], effectiveDate: "2024-01-01", expirationDate: "2025-01-01",
      premium: 5000, documentType: "policy",
      rawExtractionResponse: "blob", rawMetadataResponse: "blob2",
    };
    const dto = toPolicyDto(raw as any);
    expect((dto as any).rawExtractionResponse).toBeUndefined();
    expect((dto as any).raw_extraction_response).toBeUndefined();
    expect(dto.policy_number).toBe("ZR-001");
    expect(dto.policy_types).toEqual(["gl"]);
    expect(dto.created_at).toBe(1000);
  });
});

describe("toPassportDto", () => {
  it("maps camelCase to snake_case", () => {
    const raw = {
      _id: "pp1", _creationTime: 500, orgId: "org1",
      legalName: "Acme LLC", fullTimeEmployees: 42, annualRevenue: 1_000_000,
    };
    const dto = toPassportDto(raw as any);
    expect(dto.legal_name).toBe("Acme LLC");
    expect(dto.full_time_employees).toBe(42);
    expect(dto.annual_revenue).toBe(1_000_000);
    expect((dto as any)._id).toBeUndefined();
  });
});

describe("toApplicationDto", () => {
  it("maps groups and questions", () => {
    const raw = {
      _id: "app1", _creationTime: 200, orgId: "org1", title: "GL App",
      status: "draft", groups: [{
        id: "g1", title: "General", status: "pending",
        questions: [{ id: "q1", intentKey: "employee_count", answerType: "number", required: true, answer: null }],
      }],
    };
    const dto = toApplicationDto(raw as any);
    expect(dto.groups[0].questions[0].intent_key).toBe("employee_count");
    expect(dto.groups[0].questions[0].answer_type).toBe("number");
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
