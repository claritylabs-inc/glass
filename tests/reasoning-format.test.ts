import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getReasoningDisclosureLines,
  normalizeReasoningBoundarySpacing,
} from "../lib/reasoning-format";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("reasoning formatting", () => {
  it("restores missing spaces at streamed reasoning sentence boundaries", () => {
    expect(
      normalizeReasoningBoundarySpacing(
        "Let me use the generate_coi tool.The COI was generated.",
      ),
    ).toBe("Let me use the generate_coi tool. The COI was generated.");
  });

  it("derives separate disclosure rows when reasoning arrives without newlines", () => {
    expect(
      getReasoningDisclosureLines(
        'The user wants a COI for "Polychain Capital Fund IV".Let me use the generate_coi tool with the holder name.The COI was successfully generated. Let me present the result.',
      ),
    ).toEqual([
      'The user wants a COI for "Polychain Capital Fund IV".',
      "Let me use the generate_coi tool with the holder name.",
      "The COI was successfully generated.",
      "Let me present the result.",
    ]);
  });

  it("normalizes reasoning before streaming and final persistence", () => {
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(processThreadChat).toContain("function normalizeReasoningText");
    expect(processThreadChat).toContain(
      "reasoning: normalizeReasoningText(reasoning)",
    );
  });
});
