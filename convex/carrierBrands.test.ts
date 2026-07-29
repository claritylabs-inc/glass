/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { listForClient } from "./policies";
import { CARRIER_BRAND_ENRICHMENT_VERSION } from "./lib/carrierBrand";

const modules = import.meta.glob("./**/*.ts");
const listForClientFn = listForClient as any;

describe("carrier brands", () => {
  it("attaches a cached public brand to policy list results", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "client@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      const carrierBrandId = await ctx.db.insert("carrierBrands", {
        normalizedName: "allstate insurance company",
        carrierName: "Allstate Insurance Company",
        website: "https://www.allstate.com/",
        accentColor: "#0B1739",
        confidence: "high",
        sourceUrls: ["https://www.allstate.com/"],
        enrichmentVersion: CARRIER_BRAND_ENRICHMENT_VERSION,
        updatedAt: 1,
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Allstate Insurance Company",
        carrierBrandId,
        carrierBrandStatus: "ready",
        policyNumber: "A-100",
        linesOfBusiness: ["AUTOB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
      return { userId, policyId };
    });

    const rows = await t
      .withIdentity({ subject: `${ids.userId}|session` })
      .query(listForClientFn, { documentType: "policy" });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: ids.policyId,
        carrierBrand: {
          name: "Allstate Insurance Company",
          website: "https://www.allstate.com/",
          accentColor: "#0B1739",
          iconUrl: null,
          enrichmentVersion: CARRIER_BRAND_ENRICHMENT_VERSION,
        },
      }),
    ]);
  });
});
