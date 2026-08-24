import { describe, expect, test } from "vitest";

import {
  FALLBACK_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  fallbackRouteForCall,
  agentRunCompletionTelemetry,
  generatedTextFromResult,
  isPreExecutionFallbackEligibleError,
  modelTaskForCall,
  primaryRouteForCall,
} from "../convex/lib/models";
import {
  EXTRACTION_QUALITY_MODEL,
  OPERATOR_MODEL_ROUTE_GROUPS,
  OPERATOR_WEB_RETRIEVAL_PROVIDERS,
  defaultModelRouteForId,
  directProviderModelForRoute,
  isRetiredModelRoute,
  modelCapabilitiesForRoute,
  modelRouteSupportsTask,
} from "../convex/lib/modelCatalog";

describe("model routing", () => {
  test("keeps the critical default routes compatible with their inputs", () => {
    expect(MODEL_ROUTING.chat).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
    });
    expect(MODEL_ROUTING.chat_vision).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    expect(MODEL_ROUTING.voice_transcription).toEqual({
      provider: "openai",
      model: "gpt-4o-transcribe",
    });
    expect(MODEL_ROUTING.embeddings).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
    });
    expect(MODEL_ROUTING.extraction_preview).toEqual({
      provider: "fireworks",
      model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
    });

    expect(modelRouteSupportsTask("chat_vision", MODEL_ROUTING.chat_vision)).toBe(true);
    expect(modelRouteSupportsTask("chat_vision", MODEL_ROUTING.chat)).toBe(false);
    expect(
      modelRouteSupportsTask("voice_transcription", MODEL_ROUTING.voice_transcription),
    ).toBe(true);
    expect(modelCapabilitiesForRoute(MODEL_ROUTING.chat_vision)).toMatchObject({
      supportsImageInput: true,
    });
    expect(modelCapabilitiesForRoute(MODEL_ROUTING.voice_transcription)).toMatchObject({
      supportsAudioInput: true,
    });
  });

  test("maps SDK task kinds to their host tasks", () => {
    expect(modelTaskForCall("extraction", "extraction_classify")).toBe("classification");
    expect(modelTaskForCall("extraction", "extraction_long_list")).toBe("extraction");
    expect(modelTaskForCall("chat_vision", "query_reason")).toBe("chat_vision");
    expect(modelTaskForCall("extraction", "pce_impact_analysis")).toBe("analysis");
  });

  test("keeps operator extraction routes distinct and source-tree output untruncated", () => {
    expect(defaultModelRouteForId("extraction_coverage_cleanup")).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
    });
    expect(defaultModelRouteForId("extraction_coverage_recovery")).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
    });
    const operatorTasks = OPERATOR_MODEL_ROUTE_GROUPS.flatMap((group) => group.tasks);
    expect(operatorTasks).toEqual(
      expect.arrayContaining([
        "extraction_quality",
        "extraction_coverage_cleanup",
        "extraction_coverage_recovery",
        "fallback",
      ]),
    );
    expect(
      modelCapabilitiesForRoute(MODEL_ROUTING.extraction)?.taskOutputTokens
        ?.extraction_operational_profile,
    ).toBe(32_768);
  });

  test("recognizes retired models without rejecting active routes", () => {
    expect(
      isRetiredModelRoute({
        provider: "fireworks",
        model: "accounts/fireworks/models/kimi-k2p6",
      }),
    ).toBe(true);
    expect(isRetiredModelRoute(MODEL_ROUTING.extraction)).toBe(false);
  });

  test("normalizes generated text from root and step-level results", () => {
    expect(generatedTextFromResult({ text: "direct answer" })).toBe("direct answer");
    expect(
      generatedTextFromResult({ steps: [{ text: "first" }, { text: "final" }] }),
    ).toBe("final");
    expect(generatedTextFromResult({ steps: [{ toolCalls: [] }] })).toBe("");
    expect(generatedTextFromResult(undefined)).toBe("");
  });

  test("marks empty and output-limited customer responses incomplete", () => {
    const audit = {
      usedTools: [],
      completedTools: [],
      toolCalls: [],
      workflowOutcomes: [],
    };

    expect(agentRunCompletionTelemetry({ text: "", finishReason: "stop" }, audit))
      .toMatchObject({ status: "incomplete", completionIssue: "empty_response" });
    expect(
      agentRunCompletionTelemetry(
        { text: "Partial answer", finishReason: "length" },
        audit,
      ),
    ).toMatchObject({
      status: "incomplete",
      completionIssue: "output_limit",
      visibleTextLength: 14,
    });
    expect(
      agentRunCompletionTelemetry(
        { text: "Complete answer", finishReason: "stop" },
        audit,
      ),
    ).toMatchObject({ status: "complete", completionIssue: undefined });

    expect(
      agentRunCompletionTelemetry(
        { text: "", finishReason: "stop" },
        {
          usedTools: ["import_requirement_attachments"],
          completedTools: ["import_requirement_attachments"],
          toolCalls: [{ name: "import_requirement_attachments" }],
          workflowOutcomes: [{ status: "completed" }],
        },
      ),
    ).toMatchObject({
      status: "incomplete",
      completionIssue: "empty_response",
    });
  });
});

describe("model fallback policy", () => {
  test.each([
    [{ statusCode: 503, message: "temporarily unavailable" }, true],
    [{ statusCode: 404, executionStarted: true, message: "model not found" }, false],
    [{ statusCode: 400, message: "invalid tool schema" }, false],
  ])("classifies pre-execution availability failures", (error, expected) => {
    expect(isPreExecutionFallbackEligibleError(error)).toBe(expected);
  });

  test("uses only routes with direct-provider support", () => {
    expect(
      directProviderModelForRoute({ provider: "deepseek", model: "deepseek-v4-flash" }),
    ).toBeNull();
    expect(directProviderModelForRoute(MODEL_ROUTING.extraction)).toBe(
      FIREWORKS_MODEL_IDS.deepseekV4Flash,
    );
    expect(
      directProviderModelForRoute({ provider: "anthropic", model: "claude-haiku-4.5" }),
    ).toBe("claude-haiku-4-5-20251001");
  });

  test("escalates only quality-sensitive calls", () => {
    for (const call of [
      { task: "extraction" as const },
      { task: "extraction" as const, taskKind: "extraction_focused" },
      { task: "classification" as const },
      { task: "extraction" as const, taskKind: "extraction_classify" },
    ]) {
      expect(fallbackRouteForCall(call)).toBeNull();
    }

    for (const taskKind of [
      "extraction_source_tree",
      "extraction_operational_profile",
      "extraction_review",
      "extraction_referential_lookup",
    ]) {
      expect(fallbackRouteForCall({ task: "extraction", taskKind })).toEqual(
        FALLBACK_MODEL,
      );
    }
  });

  test("honors configured routes and explicit fallback boundaries", () => {
    const configured = {
      provider: "fireworks" as const,
      model: FIREWORKS_MODEL_IDS.glm52,
    };
    expect(
      fallbackRouteForCall({
        task: "extraction",
        taskKind: "extraction_review",
        primaryRoute: MODEL_ROUTING.extraction,
        fallbackRoute: configured,
      }),
    ).toEqual(configured);
    expect(
      fallbackRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        allowFallback: false,
      }),
    ).toBeNull();
    expect(
      fallbackRouteForCall({
        task: "chat",
        taskKind: "query_reason",
        primaryRoute: FALLBACK_MODEL,
      }),
    ).toBeNull();
  });

  test("starts source-tree work on the quality route", () => {
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_source_tree",
        primaryRoute: MODEL_ROUTING.extraction,
      }),
    ).toEqual(EXTRACTION_QUALITY_MODEL);
    expect(
      primaryRouteForCall({
        task: "extraction",
        taskKind: "extraction_focused",
        primaryRoute: MODEL_ROUTING.extraction,
      }),
    ).toBeNull();
  });
});

test("web retrieval defaults to direct dedicated providers", () => {
  expect(WEB_RETRIEVAL_DEFAULT).toEqual({ primary: "parallel" });
  expect(OPERATOR_WEB_RETRIEVAL_PROVIDERS).toEqual([
    "parallel",
    "exa",
    "model_default",
  ]);
  expect(WEB_RETRIEVAL_DEFAULT_ROUTES).toMatchObject({
    openai: { provider: "openai" },
    google: { provider: "google" },
    anthropic: { provider: "anthropic" },
    xai: { provider: "xai" },
  });
});
