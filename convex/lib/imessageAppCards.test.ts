import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildImessageAppCardRequests,
  dedupeImessageAppCardRequests,
  shouldCreatePolicyDetailsAppCard,
} from "./imessageAppCards";

describe("buildImessageAppCardRequests", () => {
  test("builds policy app-card requests from selected policy IDs", () => {
    const policyId = "policy-1" as Id<"policies">;

    expect(
      buildImessageAppCardRequests({
        policyIds: [policyId],
        artifacts: [],
        usedTools: [],
      }),
    ).toEqual([
      {
        key: `policy:${policyId}`,
        createArgs: {
          kind: "policy",
          policyId,
          label: "Policy details",
        },
        card: {
          title: "Policy link",
          subtitle: "Open this policy in Glass",
          summary: "Here's the policy link in Glass:",
        },
      },
    ]);
  });

  test("builds certificate app-card requests from artifacts", () => {
    const certificateVersionId = "certificate-version-1" as Id<"certificateVersions">;

    expect(
      buildImessageAppCardRequests({
        policyIds: [],
        artifacts: [
          {
            type: "certificate_result",
            data: { certificateVersionId },
          },
        ],
        usedTools: [],
      }),
    ).toMatchObject([
      {
        key: `certificate:${certificateVersionId}`,
        createArgs: { kind: "certificate", certificateVersionId },
      },
    ]);
  });

  test("dedupes repeated app-card requests by key", () => {
    const policyId = "policy-3" as Id<"policies">;
    const certificateVersionId = "certificate-version-3" as Id<"certificateVersions">;
    const requests = buildImessageAppCardRequests({
      policyIds: [policyId, policyId],
      artifacts: [
        {
          type: "certificate_result",
          data: { certificateVersionId },
        },
        {
          type: "certificate_result",
          data: { certificateVersionId },
        },
      ],
      usedTools: [],
    });

    expect(requests).toHaveLength(4);
    expect(dedupeImessageAppCardRequests(requests)).toMatchObject([
      {
        key: `policy:${policyId}`,
        createArgs: { kind: "policy", policyId },
      },
      {
        key: `certificate:${certificateVersionId}`,
        createArgs: { kind: "certificate", certificateVersionId },
      },
    ]);
  });
});

describe("shouldCreatePolicyDetailsAppCard", () => {
  test("creates a card for an anaphoric policy-details request answered from context", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "Amazing. Can you give the details for that policy again?",
        responseText: [
          "Sentinel Pacific Specialty Insurance Company",
          "Policy: SPS-TPC-2026-00481-04",
          "Type: Cyber (Technology Professional and Cyber Liability)",
          "Policy period: 05/01/2026 to 05/01/2027",
          "Named insured: Clarity Labs Inc.",
        ].join("\n"),
        usedTools: [],
      }),
    ).toBe(true);
  });

  test("creates a card when policy lookup tools were used", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "What are the policy limits?",
        responseText: "The cyber aggregate limit is $2,000,000.",
        usedTools: ["lookup_policy"],
      }),
    ).toBe(true);
  });

  test("creates a card for compact policy inventory responses", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "What policies do I have on file?",
        responseText:
          "You have 1 active policy on file: Sentinel Pacific Specialty Insurance Company (Cyber: Tech Prof & Cyber Liability) SPS-TPC-2026-00481-04, effective 05/01/2026 to 05/01/2027.",
        usedTools: [],
      }),
    ).toBe(true);
  });

  test("does not create a card for unrelated short responses", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "Thanks",
        responseText: "Anytime.",
        usedTools: [],
      }),
    ).toBe(false);
  });
});
