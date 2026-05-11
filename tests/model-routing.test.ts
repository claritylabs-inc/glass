import { describe, expect, test } from "vitest";

import {
  FALLBACK_MODEL,
  fallbackRouteForCall,
  modelTaskForCall,
} from "../convex/lib/models";

describe("model task routing", () => {
  test("uses cl-sdk taskKind structure to select the host task", () => {
    expect(modelTaskForCall("extraction", "extraction_classify")).toBe("classification");
    expect(modelTaskForCall("extraction", "extraction_long_list")).toBe("extraction");
    expect(modelTaskForCall("chat", "query_reason")).toBe("chat");
    expect(modelTaskForCall("extraction", "application_extract_fields")).toBe(
      "application_authoring",
    );
    expect(modelTaskForCall("extraction", "pce_impact_analysis")).toBe("analysis");
  });
});

describe("model fallback policy", () => {
  test("does not generically escalate cheap extraction or classification calls", () => {
    expect(fallbackRouteForCall({ task: "extraction" })).toBeNull();
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_focused" })).toBeNull();
    expect(fallbackRouteForCall({ task: "classification" })).toBeNull();
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_classify" })).toBeNull();
  });

  test("allows intentional quality escalation for task kinds that warrant it", () => {
    expect(fallbackRouteForCall({ task: "extraction", taskKind: "extraction_review" })).toEqual(
      FALLBACK_MODEL,
    );
    expect(
      fallbackRouteForCall({ task: "extraction", taskKind: "extraction_referential_lookup" }),
    ).toEqual(FALLBACK_MODEL);
    expect(fallbackRouteForCall({ task: "analysis", taskKind: "pce_packet_generation" })).toEqual(
      FALLBACK_MODEL,
    );
  });

  test("does not retry when the selected route is already the fallback route", () => {
    expect(
      fallbackRouteForCall({
        task: "chat",
        taskKind: "query_reason",
        primaryRoute: FALLBACK_MODEL,
      }),
    ).toBeNull();
  });
});
