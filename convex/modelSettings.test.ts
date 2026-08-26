import { describe, expect, it } from "vitest";
import { defaultModelRouteForId } from "./lib/modelCatalog";
import { isExplicitGlobalRouteOverride } from "./modelSettings";

describe("global model route overrides", () => {
  it.each([
    { route: defaultModelRouteForId("chat"), explicit: [], expected: false },
    { route: defaultModelRouteForId("chat"), explicit: ["chat"], expected: true },
    {
      route: { provider: "openai" as const, model: "gpt-5.5" },
      explicit: [],
      expected: true,
    },
  ])("returns $expected for route $route.model", ({ route, explicit, expected }) => {
    expect(isExplicitGlobalRouteOverride("chat", route, explicit)).toBe(expected);
  });
});
