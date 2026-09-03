import { describe, expect, test } from "vitest";
import { isCompanyWikiFact } from "./orgWikiPolicy";

describe("company wiki policy", () => {
  test("accepts stable company facts", () => {
    expect(
      isCompanyWikiFact({
        orgName: "Clarity Labs Inc.",
        content: "Clarity Labs is a Delaware C corporation.",
      }),
    ).toBe(true);
    expect(
      isCompanyWikiFact({
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
        isCompanyWikiFact({
          orgName,
          content,
        }),
      ).toBe(false);
    }
  });

  test("lets a trusted extraction path through the free-text guards", () => {
    const firstPerson = "We at Clarity Labs run a single Portland warehouse.";
    expect(
      isCompanyWikiFact({ orgName: "Clarity Labs Inc.", content: firstPerson }),
    ).toBe(false);
    expect(
      isCompanyWikiFact({
        orgName: "Clarity Labs Inc.",
        content: firstPerson,
        trusted: true,
      }),
    ).toBe(true);
  });
});
