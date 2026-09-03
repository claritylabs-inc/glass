import { describe, expect, it } from "vitest";

import { buildCertificateGateEvidencePacket } from "./certificateRequestGate";

describe("buildCertificateGateEvidencePacket", () => {

  it("includes named additional insured profile evidence for LLM certificate gating", () => {
    const packet = buildCertificateGateEvidencePacket({
      certificateHolder: "Northwoods Customer LLC",
      requestText: "Add this customer as additional insured on the COI",
      policy: {
        operationalProfile: {
          additionalInsuredEligibility: {
            scheduledAdditionalInsureds: [
              {
                name: "Northwoods Customer LLC",
                scope: "Scheduled additional insured by endorsement.",
                endorsementTitle: "Additional Insured Endorsement",
                sourceSpanIds: ["span-scheduled-ai"],
              },
            ],
          },
          additionalInsureds: [
            {
              name: "Northwoods Customer LLC",
              status: "scheduled_by_endorsement",
              scope: "Scheduled additional insured by endorsement.",
              endorsementTitle: "Additional Insured Endorsement",
              sourceSpanIds: ["span-scheduled-ai"],
            },
          ],
        },
      },
      sourceNodes: [
        {
          nodeId: "endorsement-node",
          kind: "endorsement",
          title: "Additional Insured Endorsement",
          path: "Policy / Endorsements / Additional Insured Endorsement",
          description: "Northwoods Customer LLC is added as an additional insured.",
          textExcerpt: "Northwoods Customer LLC is added as an additional insured.",
          sourceSpanIds: ["span-scheduled-ai"],
          pageStart: 31,
        },
      ],
    });

    const text = packet.map((item) => `${item.label}\n${item.text}`).join("\n\n");
    expect(text).toContain("Northwoods Customer LLC");
    expect(text).toContain("scheduled_by_endorsement");
    expect(packet.some((item) => item.sourceSpanIds?.includes("span-scheduled-ai"))).toBe(true);
  });
});
