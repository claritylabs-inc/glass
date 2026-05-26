import { describe, expect, it } from "vitest";
import { applyCoverageDeclarationScoping } from "../convex/lib/coverageScoping";

describe("coverage declaration scoping", () => {
  it("does not deterministically collapse competing coverage limits", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        coverages: [
          {
            name: "Errors and Omissions",
            limit: "$1,000,000",
            limitType: "per_claim",
            originalContent: "Available option: $1,000,000",
          },
          {
            name: "Errors and Omissions",
            limit: "$2,000,000",
            limitType: "per_claim",
            sourceSpanIds: ["span-2"],
          },
        ],
      },
      sourceSpans: [
        {
          id: "span-2",
          text: "Declarations - Errors and Omissions Limit $2,000,000 per claim",
          pageStart: 2,
        },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.fields.coverages).toHaveLength(2);
    expect(result.review.questions).toHaveLength(0);
  });
});
