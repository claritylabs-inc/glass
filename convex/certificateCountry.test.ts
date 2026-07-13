/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { toCertificateVersionDto } from "./lib/apiDto";

const modules = import.meta.glob("./**/*.ts");
const generateForOrg = internal.certificates.generateForOrg as any;

describe("certificate holder country persistence", () => {
  test("round-trips country through generation, holder storage, issued snapshot, and DTO", async () => {
    const t = convexTest(schema, modules);
    const { orgId, policyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Example Carrier",
        policyNumber: "COUNTRY-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        isRenewal: false,
        coverages: [],
        insuredName: "Example Client",
        pipelineStatus: "complete",
        extractionDataStage: "final",
      });
      return { orgId, policyId };
    });

    const request = {
      orgId,
      policyId,
      holderName: "Ozumo Concepts International LLC",
      addressLine1: "161 Steuart St",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "United States",
      descriptionOfOperations: "Restaurant and bar",
      source: "api" as const,
    };
    const result = await t.action(generateForOrg, request);

    expect(result).toMatchObject({ status: "generated" });
    await expect(t.action(generateForOrg, request)).resolves.toMatchObject({
      status: "existing",
      versionNumber: 1,
    });
    await expect(t.action(generateForOrg, { ...request, forceReissue: true })).resolves.toMatchObject({
      status: "generated",
      versionNumber: 2,
    });

    const { holder, versions } = await t.run(async (ctx) => {
      const holder = (await ctx.db.query("certificateHolders").collect())[0];
      const versions = await ctx.db.query("certificateVersions").collect();
      return { holder, versions };
    });
    expect(holder?.address?.country).toBe("United States");
    expect(versions).toHaveLength(2);
    expect(versions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        holderSnapshot: expect.objectContaining({
          address: expect.objectContaining({ country: "United States" }),
        }),
      }),
    ]));
    const version = versions.find((candidate) => candidate.status === "issued");
    expect(toCertificateVersionDto({
      ...version!,
      holder,
    })).toMatchObject({
      description_of_operations: "Restaurant and bar",
      holder: { address: { country: "United States" } },
      holder_snapshot: { address: { country: "United States" } },
    });
  });
});
