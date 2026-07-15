/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { policyCertificateDedupeKey } from "./lib/certificateIdentity";

const modules = import.meta.glob("./**/*.ts");
const recordIssuedVersion =
  internal.certificateLifecycle.recordIssuedVersionInternal as any;

describe("certificate holder revision", () => {
  test("updates current holder details while preserving prior version snapshots", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        email: "client@example.com",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
        uploadedByUserId: userId,
      });
      const holderId = await ctx.db.insert("certificateHolders", {
        orgId,
        displayName: "Old Holder LLC",
        normalizedName: "old holder llc",
        contactName: "Old Contact",
        email: "old@example.com",
        normalizedEmail: "old@example.com",
        phone: "+14155550100",
        address: {
          line1: "100 Old Street",
          city: "Oakland",
          state: "CA",
          postalCode: "94607",
          country: "US",
        },
        normalizedAddressKey: "100 old street|oakland|ca|94607|us",
        mapboxFeatureId: "old-address",
        mapboxMetadata: { source: "mapbox" },
        source: "certificate_generation",
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const certificateId = await ctx.db.insert("policyCertificates", {
        orgId,
        policyId,
        holderId,
        status: "active",
        dedupeKey: policyCertificateDedupeKey({
          orgId: String(orgId),
          policyId: String(policyId),
          holderId: String(holderId),
        }),
        source: "policy_page",
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const oldFileId = await ctx.storage.store(
        new Blob(["old certificate"], { type: "application/pdf" }),
      );
      const oldVersionId = await ctx.db.insert("certificateVersions", {
        orgId,
        certificateId,
        holderId,
        policyId,
        versionNumber: 1,
        status: "issued",
        fileId: oldFileId,
        fileName: "old.pdf",
        certificateHolderName: "Old Holder LLC",
        holderSnapshot: {
          displayName: "Old Holder LLC",
          contactName: "Old Contact",
          email: "old@example.com",
          phone: "+14155550100",
          address: { line1: "100 Old Street" },
        },
        source: "policy_page",
        requestKind: "holder",
        formCode: "acord25",
        issuedAt: now,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(certificateId, {
        currentVersionId: oldVersionId,
        latestIssuedVersionId: oldVersionId,
        lastIssuedAt: now,
      });
      const newFileId = await ctx.storage.store(
        new Blob(["new certificate"], { type: "application/pdf" }),
      );
      return {
        orgId,
        userId,
        policyId,
        holderId,
        certificateId,
        oldVersionId,
        newFileId,
      };
    });

    const result = await t.mutation(recordIssuedVersion, {
      orgId: ids.orgId,
      certificateId: ids.certificateId,
      holderId: ids.holderId,
      policyId: ids.policyId,
      fileId: ids.newFileId,
      fileName: "new.pdf",
      certificateHolderName: "New Holder LLC",
      holderContactName: "New Contact",
      holderEmail: "NEW@EXAMPLE.COM",
      holderPhone: "+14155550200",
      holderAddress: {
        line1: "200 New Street",
        line2: "Suite 4",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US",
      },
      updateHolderDetails: true,
      source: "policy_page",
      requestKind: "holder",
      formCode: "acord25",
      createdByUserId: ids.userId,
    });

    expect(result.versionNumber).toBe(2);
    const state = await t.run(async (ctx) => ({
      holder: await ctx.db.get(ids.holderId),
      certificate: await ctx.db.get(ids.certificateId),
      oldVersion: await ctx.db.get(ids.oldVersionId),
      newVersion: await ctx.db.get(result.versionId),
    }));

    expect(state.holder).toMatchObject({
      displayName: "New Holder LLC",
      normalizedName: "new holder llc",
      contactName: "New Contact",
      email: "NEW@EXAMPLE.COM",
      normalizedEmail: "new@example.com",
      phone: "+14155550200",
      address: {
        line1: "200 New Street",
        line2: "Suite 4",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US",
      },
      source: "manual",
      sourceRef: String(ids.certificateId),
      updatedByUserId: ids.userId,
    });
    expect(state.holder?.mapboxFeatureId).toBeUndefined();
    expect(state.holder?.mapboxMetadata).toBeUndefined();
    expect(state.oldVersion).toMatchObject({
      status: "superseded",
      certificateHolderName: "Old Holder LLC",
      holderSnapshot: {
        displayName: "Old Holder LLC",
        contactName: "Old Contact",
        email: "old@example.com",
      },
    });
    expect(state.newVersion).toMatchObject({
      status: "issued",
      versionNumber: 2,
      certificateHolderName: "New Holder LLC",
      holderSnapshot: {
        displayName: "New Holder LLC",
        contactName: "New Contact",
        email: "NEW@EXAMPLE.COM",
        phone: "+14155550200",
        address: { line1: "200 New Street" },
      },
    });
    expect(state.certificate).toMatchObject({
      currentVersionId: result.versionId,
      latestIssuedVersionId: result.versionId,
      holderId: ids.holderId,
    });
  });
});
