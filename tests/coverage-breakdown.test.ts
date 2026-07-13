import { describe, expect, it } from "vitest";

import { buildCoverageBreakdown, formatCoverageBreakdownForPrompt } from "../convex/lib/coverageBreakdown";

describe("coverage breakdown formatting", () => {
  it("keeps duplicate schedule rows visible", () => {
    const text = formatCoverageBreakdownForPrompt({
      operationalProfile: {
        coverages: [
          {
            name: "Network Security and Privacy Liability",
            limits: [{ label: "Each Claim", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-TPC 03 25",
          },
          {
            name: "Network Security and Privacy Liability",
            limits: [{ label: "Aggregate Sub-Limit", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-END 001 03 25",
          },
        ],
      },
    });

    expect(text).toContain("Coverage schedules:");
    expect(text.match(/Network Security and Privacy Liability/g)).toHaveLength(2);
  });

  it("keeps schedule rows in source order without origin buckets", () => {
    const policy = {
      operationalProfile: {
        coverages: [
          {
            name: "Technology Professional Liability",
            limits: [{ label: "Each Claim", value: "$2,000,000" }],
            formNumber: "SPS-TPC 03 25",
          },
          {
            name: "Technology Professional Liability",
            limits: [{ label: "Policy Aggregate", value: "$2,000,000" }],
            formNumber: "SPS-TPC 03 25",
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.all.map((row) => row.name)).toEqual([
      "Technology Professional Liability",
      "Technology Professional Liability",
    ]);

    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).toContain("Coverage schedules:");
  });

  it("groups coverage schedules by ACORD line of business while preserving flat order", () => {
    const policy = {
      operationalProfile: {
        linesOfBusiness: ["CGL"],
        coverages: [
          {
            name: "Commercial General Liability",
            limits: [
              { label: "Each Occurrence", value: "$1,000,000" },
              { label: "General Aggregate", value: "$2,000,000" },
              { label: "Products-Completed Operations Aggregate", value: "$2,000,000" },
            ],
            deductible: "$10,000",
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.all.map((row) => row.name)).toEqual(["Commercial General Liability"]);
    expect(breakdown.groups).toEqual([
      expect.objectContaining({
        lineOfBusiness: "CGL",
        label: "Commercial General Liability",
        items: [
          expect.objectContaining({
            name: "Commercial General Liability",
            lineOfBusiness: "CGL",
            deductible: "$10,000",
          }),
        ],
      }),
    ]);
    expect(breakdown.unassigned).toEqual([]);

    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).toContain("Commercial General Liability coverage schedules:");
    expect(text).toContain("- Commercial General Liability: Each Occurrence $1,000,000");
    expect(text).not.toContain("Products-Completed Operations Aggregate coverage schedules:");
  });

  it("leaves ambiguous multi-line rows unassigned", () => {
    const policy = {
      operationalProfile: {
        linesOfBusiness: ["CGL", "PROPC"],
        coverages: [
          {
            name: "Package Coverage",
            limits: [
              { label: "Products-Completed Operations Aggregate", value: "$2,000,000" },
            ],
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.groups).toEqual([]);
    expect(breakdown.unassigned).toEqual([
      expect.objectContaining({
        name: "Package Coverage",
        lineOfBusiness: undefined,
      }),
    ]);
    expect(formatCoverageBreakdownForPrompt(policy)).toContain("Coverage schedules:");
  });

  it("preserves coverage and nested-term provenance for PDF navigation", () => {
    const breakdown = buildCoverageBreakdown({
      operationalProfile: {
        coverages: [{
          name: "Technology Professional Liability",
          sourceNodeIds: ["coverage-node"],
          sourceSpanIds: ["coverage-span"],
          limits: [{
            label: "Each Claim",
            value: "$2,000,000",
            sourceNodeIds: ["term-node"],
            sourceSpanIds: ["term-span"],
          }],
        }],
      },
    });

    expect(breakdown.all[0]).toMatchObject({
      sourceNodeIds: ["coverage-node"],
      sourceSpanIds: ["coverage-span"],
      limits: [expect.objectContaining({
        sourceNodeIds: ["term-node"],
        sourceSpanIds: ["term-span"],
      })],
    });

    const legacy = buildCoverageBreakdown({
      coverages: [{
        name: "Legacy coverage",
        documentNodeId: "legacy-node",
        pageNumber: 6,
      }],
    });
    expect(legacy.all[0]).toMatchObject({
      documentNodeId: "legacy-node",
      pageNumber: 6,
    });
  });

  it("keeps billing out of coverages and preserves referenced asset schedules", () => {
    const policy = {
      operationalProfile: {
        linesOfBusiness: ["AUTOB"],
        coverages: [{
          name: "Commercial Auto Physical Damage",
          premium: "$1,300.00",
          limits: [
            { kind: "premium", label: "Premium", value: "$1,300.00" },
            { kind: "other", label: "Maximum per Occurrence", value: "$250,000" },
          ],
        }],
      },
      coverageSchedules: [{
        name: "Covered Auto Schedule",
        kind: "vehicle",
        description: "Unscheduled autos are excluded.",
        items: [{
          label: "Scheduled vehicle 1",
          values: [{ label: "PD Limit", value: "$15,000" }],
          sourceSpanIds: ["schedule-item"],
        }],
        sourceSpanIds: ["schedule"],
        pageStart: 20,
        pageEnd: 20,
      }],
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.all[0]).not.toHaveProperty("premium");
    expect(breakdown.all[0]?.limits).toEqual([
      expect.objectContaining({ label: "Maximum per Occurrence", value: "$250,000" }),
    ]);
    expect(breakdown.schedules).toEqual([
      expect.objectContaining({
        name: "Covered Auto Schedule",
        items: [expect.objectContaining({ sourceSpanIds: ["schedule-item"] })],
      }),
    ]);
    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).not.toContain("premium $1,300.00");
    expect(text).toContain("Scheduled vehicle 1: PD Limit $15,000");
  });
});
