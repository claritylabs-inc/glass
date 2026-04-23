import { describe, expect, it } from "vitest";
import {
  emptyIntentGraph,
  type IntentGraph,
  type IntentNode,
} from "../../convex/lib/applicationIntentGraph";
import { matchNodes, scoreGraph, scoreStructure } from "./scoring";

function node(id: string, prompt: string, answerType: IntentNode["answerType"] = "text"): IntentNode {
  return {
    id,
    prompt,
    answerType,
    required: false,
    evidenceFieldIds: [],
  };
}

describe("matchNodes", () => {
  it("matches identical prompts across id changes", () => {
    const golden = [node("g1", "Business name"), node("g2", "Year founded")];
    const candidate = [node("c1", "Business name"), node("c2", "Year founded")];
    const { matches, unmatchedGolden, unmatchedCandidate } = matchNodes(golden, candidate);
    expect(matches).toHaveLength(2);
    expect(unmatchedGolden).toHaveLength(0);
    expect(unmatchedCandidate).toHaveLength(0);
  });

  it("tolerates prompt-rewriter drift", () => {
    const golden = [node("g1", "Name of the applicant business")];
    const candidate = [node("c1", "Applicant business name")];
    const { matches } = matchNodes(golden, candidate);
    expect(matches).toHaveLength(1);
  });

  it("flags type mismatch but still matches the node", () => {
    const golden = [node("g1", "Business address", "address")];
    const candidate = [node("c1", "Business address", "text")];
    const { matches } = matchNodes(golden, candidate);
    expect(matches).toHaveLength(1);
    expect(matches[0].typeMatches).toBe(false);
  });

  it("reports unmatched on both sides", () => {
    const golden = [node("g1", "Business name"), node("g2", "Year founded")];
    const candidate = [node("c1", "Business name"), node("c2", "Annual revenue")];
    const res = matchNodes(golden, candidate);
    expect(res.matches).toHaveLength(1);
    expect(res.unmatchedGolden).toEqual(["g2"]);
    expect(res.unmatchedCandidate).toEqual(["c2"]);
  });
});

describe("scoreGraph", () => {
  it("scores an empty vs empty graph as a pass", () => {
    const golden = emptyIntentGraph();
    const candidate = emptyIntentGraph();
    const score = scoreGraph(golden, candidate);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.passes).toBe(true);
  });

  it("fails when recall is below the threshold", () => {
    const golden: IntentGraph = {
      version: 1,
      nodes: [node("g1", "A"), node("g2", "B"), node("g3", "C"), node("g4", "D")],
      edges: [],
      groups: [],
    };
    const candidate: IntentGraph = {
      version: 1,
      nodes: [node("c1", "A")],
      edges: [],
      groups: [],
    };
    const score = scoreGraph(golden, candidate);
    expect(score.recall).toBeLessThan(score.thresholds.recall);
    expect(score.passes).toBe(false);
  });

  it("scores conditional edges when endpoints map cleanly", () => {
    const golden: IntentGraph = {
      version: 1,
      nodes: [node("g1", "Is subsidiary?"), node("g2", "Parent company name")],
      edges: [{ kind: "conditional", from: "g1", to: "g2", when: { yes: true } }],
      groups: [],
    };
    const candidate: IntentGraph = {
      version: 1,
      nodes: [node("c1", "Is subsidiary?"), node("c2", "Parent company name")],
      edges: [{ kind: "conditional", from: "c1", to: "c2", when: { yes: true } }],
      groups: [],
    };
    const { matches } = matchNodes(golden.nodes, candidate.nodes);
    const s = scoreStructure(golden, candidate, matches);
    expect(s.f1).toBe(1);
  });
});
