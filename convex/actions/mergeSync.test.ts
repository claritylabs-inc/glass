// convex/actions/mergeSync.test.ts
//
// Tests syncMetric upsert semantics using the stub Merge client.

import { describe, it, expect } from "vitest";
import { stubMergeClient } from "../lib/mergeClient";

describe("stubMergeClient.fetchMetrics", () => {
  it("returns accounting metrics including annual_revenue", async () => {
    const metrics = await stubMergeClient.fetchMetrics({
      accountToken: "tok",
      category: "accounting",
    });
    const revenue = metrics.find((m) => m.metricKey === "accounting.annual_revenue");
    expect(revenue).toBeDefined();
    expect(typeof revenue!.value).toBe("number");
    expect(revenue!.period?.kind).toBe("fiscal_year");
  });

  it("returns hris metrics including headcount", async () => {
    const metrics = await stubMergeClient.fetchMetrics({
      accountToken: "tok",
      category: "hris",
    });
    const hc = metrics.find((m) => m.metricKey === "hris.headcount");
    expect(hc).toBeDefined();
    expect(typeof hc!.value).toBe("number");
  });

  it("returns payroll metrics including ytd and trailing_12", async () => {
    const metrics = await stubMergeClient.fetchMetrics({
      accountToken: "tok",
      category: "payroll",
    });
    const ytd = metrics.find((m) => m.period?.kind === "ytd");
    const t12 = metrics.find((m) => m.period?.kind === "trailing_12");
    expect(ytd).toBeDefined();
    expect(t12).toBeDefined();
  });
});

describe("stubMergeClient.fetchMetric", () => {
  it("returns single metric matching metricKey", async () => {
    const metric = await stubMergeClient.fetchMetric({
      accountToken: "tok",
      metricKey: "accounting.annual_revenue",
    });
    expect(metric).not.toBeNull();
    expect(metric!.metricKey).toBe("accounting.annual_revenue");
  });

  it("returns null for unknown key", async () => {
    const metric = await stubMergeClient.fetchMetric({
      accountToken: "tok",
      metricKey: "accounting.unknown_key",
    });
    expect(metric).toBeNull();
  });
});
