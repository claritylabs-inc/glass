import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyCoveredAssets } from "@/app/policies/[id]/policy-covered-assets";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";

type CoveredAssetSchedule = CoverageBreakdown["schedules"][number];

describe("PolicyCoveredAssets", () => {
  it("shows one vehicle list and the vehicle count when aligned schedules omit VINs", () => {
    const schedules: CoveredAssetSchedule[] = [
      {
        name: "Covered Auto Schedule - Motor Truck Cargo",
        kind: "vehicle",
        items: [
          {
            label: "Scheduled vehicle 1",
            values: [
              { label: "VIN", value: "N/A" },
              { label: "PD Limit", value: "$15,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: [],
          },
          {
            label: "Scheduled vehicle 2",
            values: [
              { label: "VIN", value: "N/A" },
              { label: "PD Limit", value: "$10,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: [],
          },
        ],
        sourceSpanIds: [],
      },
      {
        name: "Covered Auto Schedule - Commercial Auto Physical Damage",
        kind: "vehicle",
        items: [
          {
            label: "Scheduled vehicle 1",
            values: [
              { label: "PD Limit", value: "$15,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: [],
          },
          {
            label: "Scheduled vehicle 2",
            values: [
              { label: "PD Limit", value: "$10,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: [],
          },
        ],
        sourceSpanIds: [],
      },
    ];

    const markup = renderToStaticMarkup(
      <PolicyCoveredAssets schedules={schedules} />,
    );

    expect(markup).toContain("Covered property &amp; vehicles");
    expect(markup).toContain("2 vehicles");
    expect(markup.match(/Scheduled vehicle 1/g)).toHaveLength(1);
    expect(markup.match(/Scheduled vehicle 2/g)).toHaveLength(1);
    expect(markup).not.toContain("PD Limit");
    expect(markup).not.toContain("$15,000");
    expect(markup).not.toContain("Status");
    expect(markup).not.toContain("Active");
    expect(markup.match(/VIN not specified in policy schedule/g)).toHaveLength(
      2,
    );
    expect(markup).not.toContain("N/A");
  });

  it("shows exact vehicle identity fields when they are available", () => {
    const schedules: CoveredAssetSchedule[] = [
      {
        name: "Covered Auto Schedule",
        kind: "vehicle",
        items: [
          {
            label: "Scheduled vehicle 1",
            values: [
              { label: "VIN", value: "1M8GDM9AXKP042788" },
              { label: "Year", value: "2024" },
              { label: "Make", value: "Freightliner" },
              { label: "PD Limit", value: "$150,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: [],
          },
        ],
        sourceSpanIds: [],
      },
    ];

    const markup = renderToStaticMarkup(
      <PolicyCoveredAssets schedules={schedules} />,
    );

    expect(markup).toContain("1 vehicle");
    expect(markup).toContain("VIN");
    expect(markup).toContain("1M8GDM9AXKP042788");
    expect(markup).toContain("Freightliner");
    expect(markup).not.toContain("VIN not specified");
    expect(markup).not.toContain("PD Limit");
    expect(markup).not.toContain("Status");
  });

  it("shows covered property addresses and exact declaration details", () => {
    const schedules: CoveredAssetSchedule[] = [
      {
        name: "Property Schedule",
        kind: "property",
        items: [
          {
            label: "123 Main Street, Austin, TX 78701",
            description: "Office",
            values: [
              { label: "Construction", value: "Masonry" },
              { label: "Year built", value: "2018" },
            ],
            sourceSpanIds: [],
          },
        ],
        sourceSpanIds: [],
      },
    ];

    const markup = renderToStaticMarkup(
      <PolicyCoveredAssets schedules={schedules} />,
    );

    expect(markup).toContain("1 property");
    expect(markup).toContain("123 Main Street, Austin, TX 78701");
    expect(markup).toContain("Office");
    expect(markup).toContain("Construction");
    expect(markup).toContain("Masonry");
    expect(markup).not.toContain("Address not specified");
  });

  it("makes a missing covered-property address explicit", () => {
    const schedules: CoveredAssetSchedule[] = [
      {
        name: "Property Schedule",
        kind: "property",
        items: [
          {
            label: "Scheduled property 1",
            values: [{ label: "Occupancy", value: "Office" }],
            sourceSpanIds: [],
          },
        ],
        sourceSpanIds: [],
      },
    ];

    const markup = renderToStaticMarkup(
      <PolicyCoveredAssets schedules={schedules} />,
    );

    expect(markup).toContain("1 property");
    expect(markup).toContain("Occupancy");
    expect(markup).toContain("Office");
    expect(markup).toContain("Address not specified in policy schedule");
  });

  it("keeps differing schedules separate with a count for each", () => {
    const schedules: CoveredAssetSchedule[] = [
      {
        name: "Owned Auto Schedule",
        kind: "vehicle",
        items: [
          { label: "Owned vehicle", values: [], sourceSpanIds: [] },
        ],
        sourceSpanIds: [],
      },
      {
        name: "Hired Auto Schedule",
        kind: "vehicle",
        items: [
          { label: "Hired vehicle 1", values: [], sourceSpanIds: [] },
          { label: "Hired vehicle 2", values: [], sourceSpanIds: [] },
        ],
        sourceSpanIds: [],
      },
    ];

    const markup = renderToStaticMarkup(
      <PolicyCoveredAssets schedules={schedules} />,
    );

    expect(markup).toContain("Owned Auto Schedule");
    expect(markup).toContain("1 vehicle");
    expect(markup).toContain("Hired Auto Schedule");
    expect(markup).toContain("2 vehicles");
  });
});
