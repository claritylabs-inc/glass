import { describe, expect, it } from "vitest";
import {
  SOURCE_NODE_MATCH_LIMIT,
  rankSourceNodesForQuery,
} from "./agentPrompts";

describe("agent prompt retrieval bounds", () => {
  it("ranks representative source matches and enforces the match limit", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => ({
      policyId: index % 2 === 0 ? "policy-a" : "policy-b",
      nodeId: `node-${index}`,
      title: index === 17 ? "Terrorism Risk Insurance Act Disclosure" : "Declarations",
      kind: index === 17 ? "schedule" : "text",
      path: `forms.${index}`,
      description:
        index === 17
          ? "TRIA coverage disclosure and terrorism premium detail"
          : "general policy text",
      textExcerpt:
        index === 17
          ? "This endorsement explains terrorism coverage, TRIA, and related notices."
          : "Unrelated insurance wording.",
      order: 30 - index,
    }));

    const ranked = rankSourceNodesForQuery(
      "Does this policy include terrorism or TRIA coverage?",
      nodes,
    );

    expect(ranked).toHaveLength(SOURCE_NODE_MATCH_LIMIT);
    expect(ranked[0]).toMatchObject({
      nodeId: "node-17",
      title: "Terrorism Risk Insurance Act Disclosure",
    });
  });

  it("retrieves accented and non-Latin policy terms", () => {
    const nodes = [
      {
        policyId: "policy-zurich",
        nodeId: "node-zurich",
        title: "Zürich 東京 Schedule",
        kind: "schedule",
        path: "forms.zurich",
        description: "Coverage for São Paulo operations",
        textExcerpt: "東京 office details",
        order: 1,
      },
    ];
    expect(rankSourceNodesForQuery("ZÜRICH 東京", nodes)).toMatchObject([
      { nodeId: "node-zurich" },
    ]);
  });
});
