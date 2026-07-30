/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { getByToken } from "./appCardLinks";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const getByTokenFn = getByToken as any;

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("public app-card policy serialization", () => {
  it("includes continuous policy term semantics", async () => {
    const t = convexTest(schema, modules);
    const token = "continuous-policy-card";
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Continuous Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Continuous Carrier",
        policyNumber: "CONT-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        policyTermType: "continuous",
        isRenewal: false,
        coverages: [],
        insuredName: "Continuous Client",
      });
      await ctx.db.insert("appCardAccessLinks", {
        orgId,
        policyId,
        tokenHash: await tokenHash(token),
        kind: "policy",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const view = await t.query(getByTokenFn, { token });

    expect(view?.policy).toMatchObject({
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      policyTermType: "continuous",
    });
  });

  it("uses insurer overrides without retaining mismatched extracted branding", async () => {
    const t = convexTest(schema, modules);
    const token = "overridden-insurer-policy-card";
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Override Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Extracted Carrier",
        carrierIdentity: {
          displayName: "Extracted Brand",
          sourceName: "Extracted Carrier",
          legalEntities: [{
            name: "Extracted Carrier",
            sourceNodeIds: ["carrier-node"],
            sourceSpanIds: ["carrier-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["carrier-node"],
          sourceSpanIds: ["carrier-span"],
          branding: {
            website: "https://extracted.example",
            accentColor: "#123456",
            confidence: "high",
            sourceUrls: ["https://extracted.example"],
            enrichmentVersion: 16,
            updatedAt: 1,
          },
        },
        policyDetailOverrides: {
          insurer: {
            name: "Corrected Insurer",
            address: {},
            naicNumber: "",
          },
        },
        policyNumber: "OVERRIDE-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Override Client",
      });
      await ctx.db.insert("appCardAccessLinks", {
        orgId,
        policyId,
        tokenHash: await tokenHash(token),
        kind: "policy",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const view = await t.query(getByTokenFn, { token });

    expect(view).toMatchObject({
      subtitle: "Override Client - Corrected Insurer",
      policy: {
        carrier: "Corrected Insurer",
      },
    });
    expect(view?.policy?.carrierIdentity).toBeUndefined();
  });
});
