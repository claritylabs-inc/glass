/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { updateOrganizationProfile } from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const updateOrganizationProfileFn = updateOrganizationProfile as any;

describe("manual organization profile", () => {
  test("persists and validates current-company overrides", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      const clientUserId = await ctx.db.insert("users", { email: "client@example.com" });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "admin",
      });
      return { clientUserId, clientOrgId };
    });

    const profile = {
      mailingAddress: { street1: "10 Client Street", country: "Canada" },
      entityType: "corporation",
      fein: "12-3456789",
      businessNumber: "123456789",
      operationsDescription: "Fleet technology services",
    };
    const client = t.withIdentity({ subject: `${ids.clientUserId}|session` });
    await client.mutation(updateOrganizationProfileFn, { profile });

    const stored = await t.run((ctx) => ctx.db.get(ids.clientOrgId));
    expect(stored?.profileOverrides).toEqual(profile);
    expect(stored?.profileFacts ?? {}).not.toHaveProperty("producer");
    expect(stored?.profileFacts ?? {}).not.toHaveProperty("insurer");
    expect(stored?.profileFacts ?? {}).not.toHaveProperty("mga");

    const partialProfile = {
      mailingAddress: { street1: "111 Richmond" },
      entityType: "",
      fein: "",
      businessNumber: "",
      operationsDescription: "Fleet technology services",
    };
    const savedPartial = await client.mutation(updateOrganizationProfileFn, {
      profile: partialProfile,
    });
    expect(savedPartial).toEqual(partialProfile);
    const partialStored = await t.run((ctx) => ctx.db.get(ids.clientOrgId));
    expect(partialStored?.profileOverrides).toEqual({
      mailingAddress: { street1: "111 Richmond" },
      fein: "",
      businessNumber: "",
      operationsDescription: "Fleet technology services",
    });

    await client.mutation(updateOrganizationProfileFn, { profile: null });
    const reset = await t.run((ctx) => ctx.db.get(ids.clientOrgId));
    expect(reset?.profileOverrides).toBeUndefined();

    await expect(client.mutation(updateOrganizationProfileFn, {
      profile: { ...profile, entityType: "bespoke model output" },
    })).rejects.toThrow();
    await expect(client.mutation(updateOrganizationProfileFn, {
      profile: { ...profile, fein: "123" },
    })).rejects.toThrow("FEIN must contain 9 digits");
    await expect(client.mutation(updateOrganizationProfileFn, {
      profile: { ...profile, businessNumber: "12AB" },
    })).rejects.toThrow("Business number must be 9 digits");

    const afterInvalidAttempts = await t.run((ctx) => ctx.db.get(ids.clientOrgId));
    expect(afterInvalidAttempts?.profileOverrides).toBeUndefined();
  });
});
