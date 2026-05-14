/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { buildFollowUpThreadContext, type ComplianceEvent } from "./vendorComplianceMonitor";

const baseEvent: ComplianceEvent = {
  type: "vendor_compliance_gap",
  title: "Cios is waiting on policies",
  body: "8 vendor requirements need attention for Cios.",
  severity: "warning",
  clientOrgId: "clientOrg" as any,
  clientName: "Clarity Labs",
  vendorOrgId: "vendorOrg" as any,
  vendorName: "Cios",
  relationshipId: "relationship" as any,
  issueLines: [
    "Commercial General Liability: missing - No active policy appears to match this requirement.",
    "Business Automobile Liability: missing - No active policy appears to match this requirement.",
  ],
};

describe("buildFollowUpThreadContext", () => {
  test("explains why a vendor compliance draft exists and what to do next", () => {
    const result = buildFollowUpThreadContext(baseEvent, "terry@getcios.com", "draft");

    expect(result).toContain("daily vendor compliance monitor");
    expect(result).toContain("Reason:");
    expect(result).toContain("Current gaps:");
    expect(result).toContain("Review the draft below");
    expect(result).toContain("send it to terry@getcios.com");
  });

  test("uses sent-state instructions when the follow-up was auto-sent", () => {
    const result = buildFollowUpThreadContext(baseEvent, "terry@getcios.com", "sent");

    expect(result).toContain("I sent the follow-up email to terry@getcios.com");
    expect(result).toContain("review the sent email below");
  });
});
