import { describe, expect, it } from "vitest";
import { applyCoverageDeclarationScoping } from "../convex/lib/coverageScoping";

function coveragesFrom(result: ReturnType<typeof applyCoverageDeclarationScoping>) {
  return result.fields.coverages as Array<Record<string, unknown>>;
}

describe("coverage declaration scoping", () => {
  it("collapses duplicate selected limits and opens a confirmation question", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        declarations: {
          fields: [
            { label: "Errors and Omissions Limit", value: "$2,000,000 per claim" },
          ],
        },
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
          {
            name: "Errors and Omissions",
            limit: "$3,000,000",
            limitType: "per_claim",
            originalContent: "Available option: $3,000,000",
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

    expect(result.changed).toBe(true);
    expect(result.fields.coverages).toHaveLength(1);
    expect(coveragesFrom(result)[0].limit).toBe("$2,000,000");
    expect(coveragesFrom(result)[0].extractionReviewStatus).toBe("scoped_from_declarations");
    expect(result.review.questions).toHaveLength(1);
    expect(result.review.questions[0]?.options.map((option) => option.value)).toEqual([
      "$2,000,000",
      "$1,000,000",
      "$3,000,000",
    ]);
  });

  it("preserves valid occurrence and aggregate limits for the same coverage", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        coverages: [
          {
            name: "General Liability",
            limit: "$1,000,000",
            limitType: "per_occurrence",
          },
          {
            name: "General Liability",
            limit: "$2,000,000",
            limitType: "aggregate",
          },
        ],
      },
      sourceSpans: [],
    });

    expect(result.fields.coverages).toHaveLength(2);
    expect(result.review.questions).toHaveLength(0);
  });

  it("treats ambiguous same-role limits as a single current value plus follow-up options", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        coverages: [
          {
            name: "Cyber Liability",
            limit: "$1M",
            limitType: "aggregate",
          },
          {
            name: "Cyber Liability",
            limit: "$2M",
            limitType: "aggregate",
          },
        ],
      },
      sourceSpans: [],
    });

    expect(result.fields.coverages).toHaveLength(1);
    expect(coveragesFrom(result)[0].extractionReviewStatus).toBe("needs_confirmation");
    expect(result.review.questions[0]?.question).toBe("Which aggregate limit should Glass use for Cyber Liability?");
    expect(result.review.questions[0]?.options).toHaveLength(2);
  });

  it("does not treat deductibles as competing limit answers", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        coverages: [
          {
            name: "Network Security and Privacy Liability - Each Claim",
            limit: "$1,000,000",
            limitType: "per_claim",
            originalContent: "Network Security and Privacy Liability $1,000,000 Each Claim",
          },
          {
            name: "Network Security and Privacy Liability - Deductible",
            limit: "$5,000",
            originalContent: "Network Security and Privacy Liability Deductible $5,000 Each Claim",
          },
          {
            name: "Network Security and Privacy Liability - Aggregate",
            limit: "$1,000,000",
            limitType: "aggregate",
            originalContent: "Network Security and Privacy Liability $1,000,000 Aggregate",
          },
        ],
      },
      sourceSpans: [],
    });

    expect(result.fields.coverages).toHaveLength(3);
    expect(result.review.questions).toHaveLength(0);
  });
});
