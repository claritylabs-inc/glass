/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { defaultModelRouteForId } from "./lib/modelCatalog";
import { isExplicitGlobalRouteOverride } from "./modelSettings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("global model route overrides", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { route: defaultModelRouteForId("chat"), explicit: [], expected: false },
    {
      route: defaultModelRouteForId("chat"),
      explicit: ["chat"],
      expected: true,
    },
    {
      route: { provider: "openai" as const, model: "gpt-5.5" },
      explicit: [],
      expected: true,
    },
  ])(
    "returns $expected for route $route.model",
    ({ route, explicit, expected }) => {
      expect(isExplicitGlobalRouteOverride("chat", route, explicit)).toBe(
        expected,
      );
    },
  );

  it("requires an explicit marker when the operator route matches its suggestion", () => {
    const route = defaultModelRouteForId("operator_agent");

    expect(isExplicitGlobalRouteOverride("operator_agent", route, [])).toBe(
      false,
    );
    expect(
      isExplicitGlobalRouteOverride("operator_agent", route, [
        "operator_agent",
      ]),
    ).toBe(true);
  });

  it("fails closed until the required direct operator route is configured", async () => {
    const t = convexTest(schema, modules);
    const now = dayjs().valueOf();
    const { operatorUserId, settingsId, orgId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "routing-operator@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "routing-operator@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const globalSettingsId = await ctx.db.insert("globalModelSettings", {
        key: "default",
        routes: {
          operator_agent: defaultModelRouteForId("operator_agent"),
        },
        explicitRouteOverrides: [],
        updatedBy: userId,
        updatedAt: now,
      });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Routing Test Client",
        type: "client",
      });
      return {
        operatorUserId: userId,
        settingsId: globalSettingsId,
        orgId: organizationId,
      };
    });

    vi.stubEnv("OPENAI_API_KEY", "operator-openai-key");
    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).rejects.toThrow("Operator agent model is not configured");
    const manuallyChosenRoute = {
      provider: "openai" as const,
      model: "gpt-5.5",
    };
    await t.run((ctx) =>
      ctx.db.patch(settingsId, {
        routes: { operator_agent: manuallyChosenRoute },
      }),
    );
    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).rejects.toThrow("Operator agent model is not configured");
    await t.run((ctx) =>
      ctx.db.patch(settingsId, {
        explicitRouteOverrides: ["operator_agent"],
      }),
    );

    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).rejects.toThrow("not configured for direct operator-agent inference");

    vi.stubEnv("OPENAI_API_KEY", "operator-openai-key");
    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).resolves.toEqual(manuallyChosenRoute);
    const [orgSnapshot, publicSnapshot] = await Promise.all([
      t.query(internal.modelSettings.resolveForOrg, { orgId }),
      t.query(internal.modelSettings.resolvePublicDefaults, {}),
    ]);
    expect(orgSnapshot?.routes).not.toHaveProperty("operator_agent");
    expect(orgSnapshot?.routeSources).not.toHaveProperty("operator_agent");
    expect(publicSnapshot.routes).not.toHaveProperty("operator_agent");
    expect(publicSnapshot.routeSources).not.toHaveProperty("operator_agent");

    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await expect(
      operator.mutation(api.modelSettings.updateGlobalRoutes, {
        routes: { operator_agent: null },
      }),
    ).rejects.toThrow("selection is required");
  });
});
