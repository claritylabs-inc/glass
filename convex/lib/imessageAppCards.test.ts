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

  test("builds certificate and policy change app-card requests from artifacts", () => {
    const certificateVersionId = "certificate-version-1" as Id<"certificateVersions">;
    const policyChangeCaseId = "policy-change-1" as Id<"policyChangeCases">;

    expect(
      buildImessageAppCardRequests({
        policyIds: [],
        artifacts: [
          {
            type: "certificate_result",
            data: { certificateVersionId },
          },
          {
            type: "policy_change_result",
            data: { policyChangeCaseId },
          },
        ],
        usedTools: [],
      }),
    ).toMatchObject([
      {
        key: `certificate:${certificateVersionId}`,
        createArgs: { kind: "certificate", certificateVersionId },
      },
      {
        key: `policy_change:${policyChangeCaseId}`,
        createArgs: { kind: "policy_change", policyChangeCaseId },
      },
    ]);
  });

  test("adds policy-change card when policy-change tools ran", () => {
    const policyChangeCaseId = "policy-change-2" as Id<"policyChangeCases">;

    expect(
      buildImessageAppCardRequests({
        policyIds: [],
        artifacts: [],
        policyChangeCaseId,
        usedTools: ["add_policy_change_info"],
      }),
    ).toMatchObject([
      {
        key: `policy_change:${policyChangeCaseId}`,
        createArgs: { kind: "policy_change", policyChangeCaseId },
      },
    ]);
  });

  test("dedupes repeated app-card requests by key", () => {
    const policyChangeCaseId = "policy-change-3" as Id<"policyChangeCases">;
    const requests = buildImessageAppCardRequests({
      policyIds: [],
      artifacts: [
        {
          type: "policy_change_result",
          data: { policyChangeCaseId },
        },
      ],
      policyChangeCaseId,
      usedTools: ["check_policy_change_status"],
    });

    expect(requests).toHaveLength(2);
    expect(dedupeImessageAppCardRequests(requests)).toMatchObject([
      {
        key: `policy_change:${policyChangeCaseId}`,
        createArgs: { kind: "policy_change", policyChangeCaseId },
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
