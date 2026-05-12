import { describe, it, expect } from "vitest";
import { toPolicyDto, toOrgDto, toNotificationDto } from "../../convex/lib/apiDto";

describe("toPolicyDto", () => {
  it("strips raw blobs and uses snake_case", () => {
    const raw = {
      _id: "p1", _creationTime: 1000, carrier: "Zurich", policyNumber: "ZR-001",
      policyTypes: ["gl"], effectiveDate: "2024-01-01", expirationDate: "2025-01-01",
      premium: 5000, documentType: "policy",
      rawExtractionResponse: "blob", rawMetadataResponse: "blob2",
    };
    const dto = toPolicyDto(raw);
    expect(dto).not.toHaveProperty("rawExtractionResponse");
    expect(dto).not.toHaveProperty("raw_extraction_response");
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
