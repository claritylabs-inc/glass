/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { reportInternal } from "./carrierIdentityBackfill";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./lib/carrierIdentityEnrichment";

const modules = import.meta.glob("./**/*.ts");
const reportInternalFn = reportInternal as any;

describe("carrier identity backfill report", () => {
  it("aggregates results across bounded query pages", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      for (let index = 0; index < 60; index += 1) {
        const policyId = await ctx.db.insert("policies", {
          orgId,
          carrier: `Carrier ${index}`,
          carrierIdentityEnrichmentStatus:
            index % 2 === 0 ? "pending" : "failed",
          policyNumber: `REPORT-${index}`,
          linesOfBusiness: ["GL"],
          documentType: "policy",
          policyYear: 2026,
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          isRenewal: false,
          coverages: [],
          insuredName: "Client",
        });
        await ctx.db.insert("carrierIdentityBackfillResults", {
          policyId,
          outcome: "rebuilt",
          ...(index % 3 === 0
            ? { reason: "source_identity_changed" }
            : {}),
          shouldEnrich: true,
          updatedAt: index + 1,
        });
      }
    });

    const report = await t.action(reportInternalFn, {});

    expect(report).toEqual({
      total: 60,
      rebuilt: 60,
      unchanged: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      pendingEnrichment: 30,
      enrichmentFailed: 30,
      reasons: {
        source_identity_changed: 20,
      },
      enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
      latestUpdatedAt: 60,
    });
  });
});
