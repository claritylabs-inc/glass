import { describe, expect, it } from "vitest";
import { defaultModelRouteForId } from "./lib/modelCatalog";
import { isExplicitGlobalRouteOverride } from "./modelSettings";

describe("global model route overrides", () => {
  it("treats a legacy stored default route as automated routing", () => {
    expect(
      isExplicitGlobalRouteOverride(
        "chat",
        defaultModelRouteForId("chat"),
        [],
      ),
    ).toBe(false);
  });

  it("preserves an explicitly selected route even when it matches the default", () => {
    expect(
      isExplicitGlobalRouteOverride(
        "chat",
        defaultModelRouteForId("chat"),
        ["chat"],
      ),
    ).toBe(true);
  });

  it("preserves a legacy non-default route as an override", () => {
    expect(
      isExplicitGlobalRouteOverride(
        "chat",
        { provider: "openai", model: "gpt-5.5" },
        [],
      ),
    ).toBe(true);
  });
});
