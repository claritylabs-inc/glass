import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildImessageAppCardRequests,
  dedupeImessageAppCardRequests,
} from "./imessageAppCards";

describe("buildImessageAppCardRequests", () => {
  test("builds policy app-card requests from selected policy IDs", () => {
    const policyId = "policy-1" as Id<"policies">;

    expect(
      buildImessageAppCardRequests({
        policyIds: [policyId],
        artifacts: [],
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
