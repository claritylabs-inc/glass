/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { OwnComplianceEvent } from "../compliance";
import { buildOwnComplianceThreadContent } from "./ownComplianceMonitor";

const gapEvent: OwnComplianceEvent = {
  type: "own_compliance_gap",
  title: "Your insurance has compliance gaps",
  body: "One requirement needs attention.",
  severity: "warning",
  orgId: "org" as Id<"organizations">,
  orgName: "Acme",
  requirementIds: ["requirement" as Id<"insuranceRequirements">],
  issueLines: ["General liability: not met"],
};

describe("own compliance proactive threads", () => {
  test("gives the user evidence and a replyable next step", () => {
    const content = buildOwnComplianceThreadContent(gapEvent);

    expect(content).toContain("What needs attention:");
    expect(content).toContain("General liability: not met");
    expect(content).toContain("only fully extracted policies");
    expect(content).toContain("Reply with updated policy documents");
  });

  test("explains continued monitoring after resolution", () => {
    const content = buildOwnComplianceThreadContent({
      ...gapEvent,
      type: "own_compliance_resolved",
      title: "Your insurance requirements are now met",
      severity: "info",
      issueLines: ["General liability"],
    });

    expect(content).toContain("now meets every active insurance requirement");
    expect(content).toContain("keep monitoring");
  });
});
