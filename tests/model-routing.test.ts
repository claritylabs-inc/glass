import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";

import {
  FALLBACK_MODEL,
  MODEL_ROUTING,
  fallbackRouteForCall,
  modelTaskForCall,
} from "../convex/lib/models";

describe("model task routing", () => {
  test("keeps the main web chat assistant on the high-volume mini route", () => {
    expect(MODEL_ROUTING.chat).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
    });
  });

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

describe("thread chat streaming reliability", () => {
  test("retries transient provider stream errors before tool side effects", () => {
    const source = readFileSync(
      join(__dirname, "../convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(source).toContain("isTransientChatStreamError");
    expect(source).toContain('part.type === "error"');
    expect(source).toContain("hasStartedSideEffectfulWork");
    expect(source).toContain("resetStreamStateForRetry");
    expect(source).toContain("fallbackRouteForCall({");
    expect(source).toContain("Retrying chat stream after transient provider error");
  });

  test("keeps heavy mailbox tools behind the coordinator in web chat", () => {
    const source = readFileSync(
      join(__dirname, "../convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(source).toContain("coordinate_mailbox_task");
    expect(source).not.toContain("search_connected_email:");
    expect(source).not.toContain("read_connected_email_attachment:");
    expect(source).not.toContain("import_connected_email_policy_attachments:");
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

describe("mailbox coordinator routing", () => {
  test("uses gpt-5.5 for complex mailbox workflows", () => {
    expect(MODEL_ROUTING.mailbox_coordinator).toEqual({
      provider: "openai",
      model: "gpt-5.5",
    });
  });
});
