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
});
