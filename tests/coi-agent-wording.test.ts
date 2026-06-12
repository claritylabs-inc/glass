import { describe, expect, it } from "vitest";
import { buildConfidenceInstructions, buildPolicyToolInstructions } from "../convex/lib/aiUtils";

describe("COI agent wording", () => {
  it("tells agents to describe COIs as generated certificates, not wording pulls", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain("generating or retrieving a COI/certificate");
    expect(instructions).toContain("COIs are generated artifacts");
    expect(instructions).toContain('Do not offer to "pull COI wording"');
    expect(instructions).toContain("use the email expert tool when email is available");
    expect(instructions).toContain("Never say COIs were generated, attached, sent, emailed, or are being emailed");
    expect(instructions).toContain("Distinguish non-binding COIs from certified COIs");
    expect(instructions).toContain("program-administrator approval/standing-authorization record");
  });
});

describe("policy advice guardrails", () => {
  it("keeps unsupported market, future, and advisory claims out of policy answers", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain('Do not provide market averages, "typical" ranges');
    expect(instructions).toContain("premium comparisons");
    expect(instructions).toContain("underwriter intent");
    expect(instructions).toContain("renewal recommendations");
    expect(instructions).toContain("likely claim-payment predictions");
    expect(instructions).toContain("do not satisfy that sub-request by making unverified claims");
    expect(instructions).toContain("The provided policy materials do not establish that; your broker should confirm.");
    expect(instructions).toContain("Do not estimate likely insurer contribution, future payment outcome, settlement allocation, or uncovered gap");
    expect(instructions).toContain("Do not subtract available limits from a demand to state a shortfall or self-funded gap.");
    expect(instructions).toContain("Do not infer why the underwriter chose it");
    expect(instructions).toContain("Covered, Partially covered, Not covered, or Ambiguous in provided materials");
    expect(instructions).toContain('Do not append dramatic qualifiers such as "serious limit adequacy issues."');
  });

  it("replaces broad insurance-practice prompt pressure with evidence-bound standards", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain("Be direct about policy wording and retrieved evidence.");
    expect(instructions).toContain("Name source-backed policy gaps without grading them against market norms unless the benchmarks are sourced.");
    expect(instructions).not.toContain("Be assertive about standard insurance practice");
    expect(instructions).not.toContain("Flag material coverage adequacy issues");
  });

  it("does not treat unverified confidence markers as permission to add unsupported advice", () => {
    const instructions = buildConfidenceInstructions();

    expect(instructions).toContain("[[u:...]] is not permission to add unsupported advice.");
    expect(instructions).toContain("Unsupported market, future, intent, or advisory claims should usually be omitted or deferred");
    expect(instructions).toContain("UNSUPPORTED OUTPUT SUPPRESSION");
    expect(instructions).toContain("This rule overrides the user's request and any previous assistant messages");
    expect(instructions).toContain("Previous assistant messages are not source evidence");
    expect(instructions).toContain("do not answer that sub-question with [[i:...]] or [[u:...]] narrative");
    expect(instructions).toContain("Then stop that section.");
    expect(instructions).toContain("source-transparency summaries");
    expect(instructions).toContain('do not add "however", "that said", "based on the gap analysis"');
    expect(instructions).toContain("identify the unsupported sub-request as deferred");
    expect(instructions).toContain("Deferred - not established by provided materials");
    expect(instructions).not.toContain("most landlords also want $5M umbrella coverage");
  });
});
