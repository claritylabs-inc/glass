import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import { makeEmbedText, makeEmbedTexts, makeGenerateObject, makeGenerateText } from "./sdkCallbacks";

function embeddingResponse(embeddings: number[][]) {
  return {
    requestId: "embed-request-1",
    model: { provider: "openai", model: "text-embedding-3-small" },
    routing: {
      decision: "snapshot",
      candidatesConsidered: [
        { provider: "openai", model: "text-embedding-3-small" },
      ],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "global",
      attemptCount: 1,
    },
    usage: { inputTokens: 4, outputTokens: 0, cachedInputTokens: 0 },
    costUsd: 0.000001,
    costStatus: "priced",
    embeddings,
  };
}

function embeddingContext() {
  return {
    runQuery: vi.fn(async () => ({
      routes: {
        embeddings: {
          provider: "openai",
          model: "text-embedding-3-small",
        },
      },
      routeSources: { embeddings: "global" },
      providerKeys: {},
    })),
  };
}

function generationResponse(output: unknown) {
  return {
    requestId: "generate-request-1",
    model: { provider: "openai", model: "gpt-5.4-mini" },
    routing: {
      decision: "pinned",
      candidatesConsidered: [
        { provider: "openai", model: "gpt-5.4-mini" },
        { provider: "fireworks", model: "accounts/fireworks/models/deepseek-v4-pro" },
      ],
      policyVersion: "policy-v2",
      cacheStickinessApplied: false,
      routeSource: "org",
      attemptCount: 2,
    },
    usage: {
      inputTokens: 41,
      outputTokens: 7,
      cachedInputTokens: 11,
      reasoningTokens: 2,
    },
    costUsd: 0.00125,
    costStatus: "priced" as const,
    output,
    finishReason: "stop",
  };
}

function generationContext() {
  const settings = {
    routes: {
      extraction: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      extraction_quality: { provider: "openai", model: "gpt-5.4-mini" },
      extraction_coverage_cleanup: { provider: "openai", model: "gpt-5.4-mini" },
      classification: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      extraction_coverage_recovery: { provider: "openai", model: "gpt-5.4-mini" },
      chat: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      chat_vision: { provider: "openai", model: "gpt-5.6-terra" },
      analysis: {
        provider: "fireworks",
        model: "accounts/fireworks/models/glm-5p2",
      },
      fallback: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-pro",
      },
    },
    routeSources: {
      extraction: "global",
      extraction_quality: "broker",
      extraction_coverage_cleanup: "broker",
      classification: "global",
      extraction_coverage_recovery: "global",
      chat: "broker",
      chat_vision: "org",
      analysis: "global",
      fallback: "static",
    },
    providerKeys: { openai: "org-openai-key" },
  };
  return {
    settings,
    runQuery: vi.fn(async () => settings),
    runMutation: vi.fn(async () => undefined),
  };
}

describe("cl-router embedding callbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("routes batched embeddings with dimensions and settings", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "embeddings");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const firstEmbedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const secondEmbedding = Array.from({ length: 1536 }, (_, index) => 1 - index / 1536);
    const fetchMock = vi.fn(async () => Response.json(
      embeddingResponse([firstEmbedding, secondEmbedding]),
    ));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = embeddingContext();

    await expect(makeEmbedTexts(
      ctx as never,
      "org-1" as Id<"organizations">,
    )(["one", "two"])).resolves.toEqual([firstEmbedding, secondEmbedding]);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      texts: ["one", "two"],
      dimensions: 1536,
      settings: {
        routes: {
          embeddings: {
            provider: "openai",
            model: "text-embedding-3-small",
          },
        },
      },
      trace: { label: "convex.sdkCallbacks.makeEmbedTexts" },
    });
    expect(ctx.runQuery).toHaveBeenCalledOnce();
  });

  test("routes single embeddings", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "embeddings");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(embeddingResponse([embedding]))),
    );

    await expect(makeEmbedText(
      embeddingContext() as never,
      "org-1" as Id<"organizations">,
    )("one")).resolves.toEqual(embedding);
  });

  test("does not hide router client errors behind direct fallback", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "embeddings");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 422 })),
    );

    await expect(makeEmbedText(
      embeddingContext() as never,
      "org-1" as Id<"organizations">,
    )("one")).rejects.toMatchObject({ kind: "client", status: 422 });
  });
});

describe("cl-router generation callbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("preserves quality-primary extraction inputs and records actual router trace metadata", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "extraction");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(generationResponse({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = generationContext();
    const generateObject = makeGenerateObject("extraction", {
      ctx: ctx as never,
      orgId: "org-1" as Id<"organizations">,
      traceId: "trace-1",
      tracePolicyId: "policy-1",
    });
    const schema = z.object({ ok: z.boolean() });
    const input = {
      prompt: "Return effectiveDate and expirationDate.",
      system: "Extract only sourced values.",
      schema,
      maxTokens: 9_000,
      taskKind: "extraction_source_tree" as const,
      trace: {
        label: "Build source tree",
        phase: "source_tree",
        extractorName: "sourceTree",
      },
      providerOptions: {
        pdfBytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
        images: [{ imageBase64: "image-data", mimeType: "image/png" }],
      },
    };

    await expect(generateObject(input)).resolves.toEqual({
      object: { ok: true },
      usage: { inputTokens: 41, outputTokens: 7 },
    });
    await generateObject(input);

    expect(ctx.runQuery).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://router.example.test/v1/generate");
    const request = JSON.parse(init.body as string);
    expect(request).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      task: "extraction",
      taskKind: "extraction_source_tree",
      system: "Extract only sourced values.",
      maxTokens: 4_096,
      sessionKey: "trace-1",
      settings: ctx.settings,
      routing: {
        allowFallback: true,
      },
      trace: {
        traceId: "trace-1",
        label: "Build source tree",
        phase: "source_tree",
        taskKind: "extraction_source_tree",
        policyId: "policy-1",
        channel: "convex",
      },
    });
    expect(request.routing).not.toHaveProperty("pin");
    expect(request.schema).toMatchObject({
      type: "object",
      properties: { ok: { type: "boolean" } },
    });
    const messageParts = request.messages[0].content as Array<Record<string, unknown>>;
    expect(messageParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", image: "image-data", mediaType: "image/png" }),
      expect.objectContaining({ type: "file", data: "AQID", mediaType: "application/pdf" }),
    ]));
    expect(messageParts.find((part) => part.type === "text")?.text).toBe(
      "Return effectiveDate and expirationDate.",
    );

    const traceEvent = (ctx.runMutation.mock.calls as unknown[][])[0]?.[1] as
      Record<string, unknown>;
    expect(traceEvent).toMatchObject({
      traceId: "trace-1",
      kind: "model_call",
      task: "extraction",
      taskKind: "extraction_source_tree",
      provider: "openai",
      model: "gpt-5.4-mini",
      routeSource: "org",
      transport: "cl-router",
      attempt: 2,
      inputTokens: 41,
      outputTokens: 7,
      cachedInputTokens: 11,
      routerRequestId: "generate-request-1",
      costUsd: 0.00125,
      costStatus: "priced",
      routingDecision: "pinned",
      routing: generationResponse(null).routing,
      status: "complete",
    });
  });

  test("maps classification task kinds for text generation without pinning", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "query_classify");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(generationResponse("classified")));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = generationContext();

    await expect(makeGenerateText("chat", {
      ctx: ctx as never,
      orgId: "org-1" as Id<"organizations">,
    })({
      prompt: "Classify this request",
      maxTokens: 100,
      taskKind: "query_classify",
    })).resolves.toEqual({
      text: "classified",
      usage: { inputTokens: 41, outputTokens: 7 },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      task: "classification",
      taskKind: "query_classify",
      routing: { allowFallback: true },
    });
    expect(JSON.parse(init.body as string).routing).not.toHaveProperty("pin");
  });

  test.each([
    {
      name: "standard extraction",
      baseTask: "extraction",
      taskKind: "extraction_focused",
      expectedTask: "extraction",
    },
    {
      name: "quality-primary extraction",
      baseTask: "extraction",
      taskKind: "extraction_operational_profile",
      expectedTask: "extraction",
    },
    {
      name: "coverage cleanup",
      baseTask: "extraction",
      taskKind: "extraction_coverage_cleanup",
      expectedTask: "extraction",
    },
    {
      name: "extraction classification",
      baseTask: "extraction",
      taskKind: "extraction_classify",
      expectedTask: "classification",
    },
    {
      name: "coverage recovery",
      baseTask: "extraction_coverage_recovery",
      taskKind: undefined,
      expectedTask: "extraction_coverage_recovery",
    },
    {
      name: "query reasoning",
      baseTask: "chat",
      taskKind: "query_reason",
      expectedTask: "chat",
    },
    {
      name: "vision query attachment",
      baseTask: "chat_vision",
      taskKind: "query_attachment",
      expectedTask: "chat_vision",
    },
    {
      name: "policy-change analysis",
      baseTask: "analysis",
      taskKind: "pce_impact_analysis",
      expectedTask: "analysis",
    },
    {
      name: "general classification",
      baseTask: "classification",
      taskKind: undefined,
      expectedTask: "classification",
    },
  ] as const)("routes $name callbacks with the expected task family", async ({
    baseTask,
    taskKind,
    expectedTask,
  }) => {
    vi.stubEnv("CL_ROUTER_TASKS", taskKind ?? baseTask);
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(generationResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = generationContext();
    const generateText = makeGenerateText(baseTask, {
      ctx: ctx as never,
      orgId: "org-1" as Id<"organizations">,
    });

    await generateText({
      prompt: "Run the routed task",
      maxTokens: 100,
      ...(taskKind ? { taskKind } : {}),
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(init.body as string);
    expect(request).toMatchObject({
      task: expectedTask,
      settings: ctx.settings,
      routing: { allowFallback: true },
    });
    if (taskKind) expect(request.taskKind).toBe(taskKind);
    else expect(request).not.toHaveProperty("taskKind");
    expect(request.routing).not.toHaveProperty("pin");
  });
});
