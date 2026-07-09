import { describe, expect, it } from "vitest";
import {
  MAX_PORTFOLIO_DOCUMENT_CONTEXT_ORGS,
  SOURCE_NODE_CANDIDATE_LIMIT_PER_ORG,
  SOURCE_NODE_MATCH_LIMIT,
  rankOrgMemoryForQuery,
  rankSourceNodesForQuery,
} from "./agentPrompts";

describe("agent prompt retrieval bounds", () => {
  it("keeps source node retrieval caps intentionally small", () => {
    expect(MAX_PORTFOLIO_DOCUMENT_CONTEXT_ORGS).toBeLessThanOrEqual(8);
    expect(SOURCE_NODE_CANDIDATE_LIMIT_PER_ORG).toBeLessThanOrEqual(600);
    expect(SOURCE_NODE_MATCH_LIMIT).toBeLessThanOrEqual(18);
  });

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

  it("prefers company facts relevant to the current question before recent noise", () => {
    const memories = [
      {
        content: "Acme renewed its office lease in Oakland.",
        updatedAt: 30,
      },
      {
        content: "Acme manufactures battery storage systems in Nevada.",
        updatedAt: 10,
      },
      {
        content: "Acme hired a new finance leader.",
        updatedAt: 20,
      },
    ];

    expect(
      rankOrgMemoryForQuery("battery manufacturing operations", memories, 2),
    ).toEqual([memories[1], memories[0]]);
  });
});
