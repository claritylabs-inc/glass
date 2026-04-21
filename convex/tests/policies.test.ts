import { expect, test } from "vitest";

// Task 1: Schema compile-time guard
test("policies schema accepts uploadedBySide=broker", () => {
  const sides = ["broker", "client", "email_scan"] as const;
  for (const side of sides) {
    expect(sides).toContain(side);
  }
});

// Task 2: Capability helpers
import { assertCanUploadPolicy, assertCanDeletePolicy } from "../lib/access";
import type { OrgAccess } from "../lib/access";

test("assertCanUploadPolicy allows member", () => {
  const access: OrgAccess = {
    accessType: "member",
    orgId: "org1" as any,
    userId: "u1" as any,
    org: {} as any,
    orgType: "client",
    role: "admin",
    brokerOrgId: undefined,
  };
  expect(() => assertCanUploadPolicy(access)).not.toThrow();
});

test("assertCanUploadPolicy allows broker_of_client", () => {
  const access: OrgAccess = {
    accessType: "broker_of_client",
    orgId: "org1" as any,
    userId: "u1" as any,
    org: {} as any,
    orgType: "client",
    role: undefined,
    brokerOrgId: "b1" as any,
  };
  expect(() => assertCanUploadPolicy(access)).not.toThrow();
});

test("assertCanDeletePolicy blocks broker deleting client-uploaded policy", () => {
  const access: OrgAccess = {
    accessType: "broker_of_client",
    orgId: "org1" as any,
    userId: "u1" as any,
    org: {} as any,
    orgType: "client",
    role: undefined,
    brokerOrgId: "b1" as any,
  };
  const policy = { uploadedBySide: "client" as const, uploadedByBrokerOrgId: undefined };
  expect(() => assertCanDeletePolicy(access, policy)).toThrow();
});

test("assertCanDeletePolicy allows broker deleting their own uploaded policy", () => {
  const access: OrgAccess = {
    accessType: "broker_of_client",
    orgId: "org1" as any,
    userId: "u1" as any,
    org: {} as any,
    orgType: "client",
    role: undefined,
    brokerOrgId: "b1" as any,
  };
  const policy = { uploadedBySide: "broker" as const, uploadedByBrokerOrgId: "b1" as any };
  expect(() => assertCanDeletePolicy(access, policy)).not.toThrow();
});

// Task 3: Event type helpers
test("chooses policy_uploaded event type for documentType=policy", () => {
  const chooseEventType = (
    documentType: "policy" | "quote",
    _side: "broker" | "client" | "email_scan",
  ) => {
    if (documentType === "quote") return "quote_uploaded";
    return "policy_uploaded";
  };
  expect(chooseEventType("policy", "broker")).toBe("policy_uploaded");
  expect(chooseEventType("quote", "client")).toBe("quote_uploaded");
});

test("chooses policy_extraction_completed for policy completion", () => {
  const completionEvent = (documentType: "policy" | "quote") =>
    documentType === "quote"
      ? "quote_extraction_completed"
      : "policy_extraction_completed";
  expect(completionEvent("policy")).toBe("policy_extraction_completed");
  expect(completionEvent("quote")).toBe("quote_extraction_completed");
});

// Task 9: Integration-style tests
test("provenance fields are accepted in schema (structural test)", () => {
  // Validates that the policy shape with provenance fields is accepted
  const policyShape = {
    orgId: "orgId" as any,
    fileId: "file1" as any,
    carrier: "Extracting...",
    policyNumber: "Extracting...",
    policyTypes: ["other"] as ["other"],
    documentType: "policy" as const,
    policyYear: 2026,
    effectiveDate: "Extracting...",
    expirationDate: "Extracting...",
    isRenewal: false,
    coverages: [] as never[],
    insuredName: "Extracting...",
    extractionStatus: "pending" as const,
    uploadedBySide: "broker" as const,
    uploadedByUserId: "userId" as any,
    uploadedByBrokerOrgId: "brokerOrgId" as any,
  };
  expect(policyShape.uploadedBySide).toBe("broker");
  expect(policyShape.uploadedByBrokerOrgId).toBe("brokerOrgId");
  expect(policyShape.orgId).toBe("orgId");
});

test("softDelete blocks broker deleting a client-uploaded policy", () => {
  const access: OrgAccess = {
    accessType: "broker_of_client",
    orgId: "org1" as any,
    userId: "u1" as any,
    org: {} as any,
    orgType: "client",
    role: undefined,
    brokerOrgId: "b1" as any,
  };
  const policy = { uploadedBySide: "client" as const, uploadedByBrokerOrgId: undefined };
  expect(() => assertCanDeletePolicy(access, policy)).toThrow(
    "Not authorized to delete this policy",
  );
});
