import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildConfidenceInstructions, buildPolicyToolInstructions } from "../convex/lib/aiUtils";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("COI agent wording", () => {
  it("tells agents to describe COIs as generated certificates, not wording pulls", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain("generating or retrieving a COI/certificate");
    expect(instructions).toContain("COIs are generated artifacts");
    expect(instructions).toContain('Do not offer to "pull COI wording"');
    expect(instructions).toContain("use the email expert tool when email is available");
    expect(instructions).toContain("Never say COIs were generated, attached, sent, emailed, or are being emailed");
    expect(instructions).toContain("Treat every generated COI as informational");
    expect(instructions).not.toContain("program-administrator");
    expect(instructions).toContain("policyParties");
    expect(instructions).toContain("Do not use public web search");
  });

  it("keeps external insurance parties policy-scoped in agent results", () => {
    const executors = read("convex/lib/agentToolExecutors.ts");
    const partyContext = read("convex/lib/policyPartyContext.ts");
    const chatTools = read("convex/lib/chatTools.ts");

    expect(executors).toContain("policyParties: partyContext.parties");
    expect(executors).toContain("carrier: partyContext.insurerName ?? policy.security");
    expect(partyContext).toContain("options.clientProfileFacts?.operationsDescription");
    expect(partyContext.indexOf("address(policy.insuredAddress)")).toBeLessThan(
      partyContext.indexOf("options.clientProfileFacts?.mailingAddress"),
    );
    expect(partyContext).not.toContain("clientProfileFacts.insuranceParties");
    expect(chatTools).toContain("policy-scoped Producer, insurer, carrier, and General Agent parties");
  });

  it("keeps internal certificate form codes out of agent inputs and outputs", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");
    const certificates = read("convex/certificates.ts");
    const existingResult = certificates.slice(
      certificates.indexOf("function existingCertificateResult"),
      certificates.indexOf("function ambiguousHolderResult"),
    );
    const generatedResult = certificates.slice(
      certificates.indexOf('status: "generated"'),
      certificates.indexOf("export const recordGenerated"),
    );

    expect(chatTools).not.toContain("certificateForm");
    expect(chatTools).not.toContain("ACORD-style");
    expect(agentToolExecutors).not.toContain("params.certificateForm");
    expect(agentToolExecutors).not.toContain("generated.formCode");
    expect(existingResult).not.toContain("formCode:");
    expect(generatedResult).not.toContain("formCode:");
  });
});

describe("policy advice guardrails", () => {
  it("keeps broad policy detail requests at a basic-summary depth by default", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain('For broad policy "details" or "summary" requests');
    expect(instructions).toContain("keep the final answer to the basic policy card");
    expect(instructions).toContain("unless the user asks for a comprehensive breakdown");
    expect(instructions).toContain("specific section such as endorsements");
  });

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
