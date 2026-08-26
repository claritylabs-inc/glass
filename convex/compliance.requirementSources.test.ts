/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { createRequirementSourceDocumentInternal } from "./compliance";
import type { Id } from "./_generated/dataModel";
import {
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderName,
} from "./lib/certificateIdentity";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const createRequirementSourceDocument =
  createRequirementSourceDocumentInternal as any;

describe("requirement source certificate holders", () => {
  test("persists every extracted holder in source order with a primary compatibility holder", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, existingHolderId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        email: "admin@cove.test",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      const address = {
        line1: "6731 N. 12th Way",
        city: "Phoenix",
        state: "AZ",
        postalCode: "85014",
      };
      const existingHolderId = await ctx.db.insert("certificateHolders", {
        orgId,
        displayName: "Captive Risk Solutions Corporation",
        normalizedName: normalizeCertificateHolderName(
          "Captive Risk Solutions Corporation",
        ),
        contactName: "Andrew Matczak",
        phone: "+1 602 555 0100",
        address,
        normalizedAddressKey: normalizeCertificateHolderAddress(address),
        source: "manual",
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      return { orgId, userId, existingHolderId };
    });

    const sourceDocumentId = (await t.mutation(
      createRequirementSourceDocument,
      {
        orgId,
        userId,
        sourceType: "client_contract",
        title: "Insurance requirements",
        holders: [
          {
            displayName: "Captive Risk Solutions Corporation",
            contactName: "Andrew Matczak",
            email: "Andrew@ladderre.com",
            address: {
              line1: "6731 N. 12th Way",
              city: "Phoenix",
              state: "AZ",
              postalCode: "85014",
            },
          },
          {
            displayName: "Building Owner LLC",
            email: "certificates@building.test",
          },
        ],
      },
    )) as Id<"requirementSourceDocuments">;

    const result = await t.run(async (ctx) => {
      const source = await ctx.db.get(sourceDocumentId);
      const holders = await Promise.all(
        (source?.certificateHolderIds ?? []).map((id) => ctx.db.get(id)),
      );
      return { source, holders };
    });

    expect(result.source?.certificateHolderIds).toHaveLength(2);
    expect(result.source?.certificateHolderId).toBe(
      result.source?.certificateHolderIds?.[0],
    );
    expect(result.source?.certificateHolderId).toBe(existingHolderId);
    expect(result.holders).toMatchObject([
      {
        displayName: "Captive Risk Solutions Corporation",
        contactName: "Andrew Matczak",
        email: "Andrew@ladderre.com",
        phone: "+1 602 555 0100",
      },
      {
        displayName: "Building Owner LLC",
        email: "certificates@building.test",
      },
    ]);
  });
});
