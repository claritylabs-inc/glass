import { describe, expect, it } from "vitest";
import { buildPolicyToolInstructions } from "../convex/lib/aiUtils";

describe("COI agent wording", () => {
  it("tells agents to describe COIs as generated certificates, not wording pulls", () => {
    const instructions = buildPolicyToolInstructions(8);

    expect(instructions).toContain("generating a new COI or certificate");
    expect(instructions).toContain("COIs are generated artifacts");
    expect(instructions).toContain('Do not offer to "pull COI wording"');
    expect(instructions).toContain("use the email expert tool when email is available");
    expect(instructions).toContain("Never say COIs were generated, attached, sent, emailed, or are being emailed");
    expect(instructions).toContain("Distinguish non-binding COIs from certified COIs");
    expect(instructions).toContain("program-administrator approval/standing-authorization record");
  });
});
