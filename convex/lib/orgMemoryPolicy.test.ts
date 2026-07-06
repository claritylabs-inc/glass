import { describe, expect, test } from "vitest";
import { isCompanyContextMemory } from "./orgMemoryPolicy";

describe("org memory policy", () => {
  test("accepts stable company facts", () => {
    expect(
      isCompanyContextMemory({
        type: "fact",
        orgName: "Clarity Labs Inc.",
        content: "Clarity Labs is a Delaware C corporation.",
      }),
    ).toBe(true);
    expect(
      isCompanyContextMemory({
        type: "fact",
        orgName: "Clarity Labs Inc.",
        content: "Clarity Labs builds AI software for commercial insurance.",
      }),
    ).toBe(true);
  });

  test("rejects policy, workflow, and request memory", () => {
    const orgName = "Clarity Labs Inc.";
    const rejected = [
      "Clarity Labs has policy SPS-TPC-2026-00481-04 effective 05/01/2026.",
      "Agent cannot initiate the intake from this chat unless a linked user starts it.",
      "The user requested the complete policy PDF.",
      "An email draft is intended for recipient terry@claritylabs.inc.",
      "Daly City City Hall address is 333 90th Street, Daly City, CA 94015.",
    ];

    for (const content of rejected) {
      expect(
        isCompanyContextMemory({
          type: "fact",
          orgName,
          content,
        }),
      ).toBe(false);
    }
  });

  test("rejects legacy non-fact memory types", () => {
    expect(
      isCompanyContextMemory({
        type: "preference",
        orgName: "Clarity Labs Inc.",
        content: "Clarity Labs prefers annual renewals.",
      }),
    ).toBe(false);
  });
});
