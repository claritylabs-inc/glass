import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import { makeEmbedTexts, makeGenerateObject } from "./sdkCallbacks";

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

  test("chunks routed embedding batches below the Convex response value limit", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "embeddings");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const texts = Array.from({ length: 131 }, (_, index) => `text-${index}`);
    const embedding = Array.from({ length: 1536 }, () => 0.25);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { texts: string[] };
      return Response.json(embeddingResponse(request.texts.map(() => embedding)));
    });
    vi.stubGlobal("fetch", fetchMock);
    const ctx = embeddingContext();

    const result = await makeEmbedTexts(
      ctx as never,
      "org-1" as Id<"organizations">,
    )(texts);

    expect(result).toHaveLength(131);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string) as {
        texts: string[];
        trace: { batchIndex: number; batchCount: number };
      });
    expect(requests.map((request) => request.texts.length)).toEqual([130, 1]);
    expect(requests.map((request) => request.trace)).toEqual([
      expect.objectContaining({ batchIndex: 1, batchCount: 2 }),
      expect.objectContaining({ batchIndex: 2, batchCount: 2 }),
    ]);
    expect(ctx.runQuery).toHaveBeenCalledOnce();
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
        pdfUrl: "https://storage.example.test/document.pdf",
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
      expect.objectContaining({
        type: "file",
        source: {
          url: "https://storage.example.test/document.pdf",
          mediaType: "application/pdf",
          filename: "document.pdf",
          sizeBytes: 3,
        },
      }),
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
});
