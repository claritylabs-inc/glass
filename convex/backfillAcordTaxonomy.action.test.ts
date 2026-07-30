/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfill,
  report,
} from "./actions/backfillAcordTaxonomy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const backfillFn = backfill as any;
const reportFn = report as any;

afterEach(() => {
  vi.useRealTimers();
});

describe("ACORD taxonomy dry-run orchestration", () => {
  it("processes and reports large dry runs through scheduled pages", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Backfill Client",
        type: "client",
      });
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert("policies", {
          orgId,
          carrier: `Carrier ${index}`,
          policyNumber: `BACKFILL-${index}`,
          linesOfBusiness: ["UN"],
          documentType: "policy",
          policyYear: 2026,
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          extractionDataStage: "final",
          isRenewal: false,
          coverages: [],
          insuredName: "Backfill Client",
        });
      }
    });

    const started = await t.action(backfillFn, {
      dryRun: true,
      limit: 2,
    });

    expect(started).toMatchObject({
      status: "running",
      scannedCount: 2,
      continuationScheduled: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const completed = await t.action(reportFn, {
      runId: started.runId,
    });
    expect(completed).toMatchObject({
      runId: started.runId,
      status: "completed",
      pageCount: 3,
      scannedCount: 5,
      continuationScheduled: false,
    });
  });
});
