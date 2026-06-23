import { describe, expect, test } from "vitest";
import { shouldCreatePolicyDetailsAppCard } from "./handleInboundImessage";

describe("shouldCreatePolicyDetailsAppCard", () => {
  test("creates a card for an anaphoric policy-details request answered from context", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "Amazing. Can you give the details for that policy again?",
        responseText: [
          "Sentinel Pacific Specialty Insurance Company",
          "Policy: SPS-TPC-2026-00481-04",
          "Type: Cyber (Technology Professional and Cyber Liability)",
          "Policy period: 05/01/2026 to 05/01/2027",
          "Named insured: Clarity Labs Inc.",
        ].join("\n"),
        usedTools: [],
      }),
    ).toBe(true);
  });

  test("creates a card when policy lookup tools were used", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "What are the policy limits?",
        responseText: "The cyber aggregate limit is $2,000,000.",
        usedTools: ["lookup_policy"],
      }),
    ).toBe(true);
  });

  test("creates a card for compact policy inventory responses", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "What policies do I have on file?",
        responseText:
          "You have 1 active policy on file: Sentinel Pacific Specialty Insurance Company (Cyber: Tech Prof & Cyber Liability) SPS-TPC-2026-00481-04, effective 05/01/2026 to 05/01/2027.",
        usedTools: [],
      }),
    ).toBe(true);
  });

  test("does not create a card for unrelated short responses", () => {
    expect(
      shouldCreatePolicyDetailsAppCard({
        messageText: "Thanks",
        responseText: "Anytime.",
        usedTools: [],
      }),
    ).toBe(false);
  });
});
