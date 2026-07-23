import { describe, expect, test, vi } from "vitest";
import {
  ClRouterRequestError,
  clRouterEmbed,
  clRouterGenerate,
  clRouterGenerateStream,
  clRouterTranscribe,
  isClRouterTaskFlagged,
  isClRouterDirectFallbackError,
  sendClRouterFeedback,
  shouldUseClRouterForCall,
  shouldUseClRouterForTask,
  withClRouterDirectFallback,
} from "./clRouterClient";

const environment = {
  CL_ROUTER_URL: "https://router.example.test/",
  CL_ROUTER_SECRET: "router-secret",
};

function responseMetadata() {
  return {
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5-mini" },
    routing: {
      decision: "policy",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5-mini" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "broker",
      attemptCount: 1,
      shadowMode: true,
      wouldHaveChosen: {
        provider: "fireworks",
        model: "accounts/fireworks/models/glm-5p2",
        decision: "autonomous_primary",
      },
      wouldHaveMatched: false,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 2,
      cacheWriteTokens: 1,
    },
    costUsd: 0.0001,
    costStatus: "priced",
  };
}

describe("cl-router feature gating", () => {
  test("is opt-in per supported task", () => {
    const flags = { CL_ROUTER_TASKS: " classification,embeddings,chat " };
    expect(shouldUseClRouterForTask("classification", flags)).toBe(true);
    expect(shouldUseClRouterForTask("embeddings", flags)).toBe(true);
    expect(shouldUseClRouterForTask("voice_transcription", flags)).toBe(false);
    expect(shouldUseClRouterForTask("chat", flags)).toBe(true);
    expect(shouldUseClRouterForTask("classification", {})).toBe(false);
    expect(shouldUseClRouterForTask("classification", { CL_ROUTER_TASKS: "*" })).toBe(true);
    expect(shouldUseClRouterForTask("chat", { CL_ROUTER_TASKS: "*" })).toBe(true);
    expect(isClRouterTaskFlagged("chat", { CL_ROUTER_TASKS: "chat" })).toBe(true);
    expect(isClRouterTaskFlagged("chat_vision", { CL_ROUTER_TASKS: "chat" })).toBe(false);
    expect(shouldUseClRouterForCall(
      "extraction",
      "extraction_source_tree",
      { CL_ROUTER_TASKS: "extraction_source_tree" },
    )).toBe(true);
    expect(shouldUseClRouterForCall(
      "extraction",
      "extraction_source_tree",
      { CL_ROUTER_TASKS: "extraction" },
    )).toBe(true);
  });
});

describe("cl-router requests", () => {
  test("sends typed generation settings and preserves routing lineage", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ...responseMetadata(),
      output: { disposition: "deliver" },
      finishReason: "stop",
    }));

    const result = await clRouterGenerate({
      task: "classification",
      taskKind: "policy_delivery",
      orgId: "org-1",
      settings: {
        routes: {
          classification: { provider: "openai", model: "gpt-5-mini" },
        },
        routeSources: { classification: "broker" },
        providerKeys: { openai: "broker-openai-key" },
      },
      prompt: "Classify this policy delivery request.",
      schema: { type: "object" },
      trace: { traceId: "trace-1", parentRequestId: "parent-1" },
    }, { environment, fetch: fetchMock });

    expect(result.requestId).toBe("request-1");
    expect(result.usage.cacheWriteTokens).toBe(1);
    expect(result.routing.policyVersion).toBe("policy-v1");
    expect(result.routing).toMatchObject({
      shadowMode: true,
      wouldHaveChosen: {
        provider: "fireworks",
        model: "accounts/fireworks/models/glm-5p2",
        decision: "autonomous_primary",
      },
      wouldHaveMatched: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://router.example.test/v1/generate");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer router-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      tenantId: "glass",
      task: "classification",
      orgId: "org-1",
      prompt: "Classify this policy delivery request.",
      trace: { traceId: "trace-1", parentRequestId: "parent-1" },
      settings: {
        providerKeys: { openai: "broker-openai-key" },
      },
    });
  });

  test.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows plaintext HTTP only for loopback host %s",
    async (host) => {
      const fetchMock = vi.fn(async () => Response.json({
        ...responseMetadata(),
        output: "ok",
      }));
      await clRouterGenerate(
        { task: "classification", prompt: "test" },
        {
          environment: {
            CL_ROUTER_URL: `http://${host}:3000`,
            CL_ROUTER_SECRET: "router-secret",
          },
          fetch: fetchMock,
        },
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test("rejects plaintext HTTP for non-loopback hosts before sending secrets", async () => {
    const fetchMock = vi.fn();
    await expect(clRouterGenerate(
      { task: "classification", prompt: "test" },
      {
        environment: {
          CL_ROUTER_URL: "http://router.internal",
          CL_ROUTER_SECRET: "router-secret",
        },
        fetch: fetchMock,
      },
    )).rejects.toMatchObject({ kind: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("parses SSE events split across transport chunks", async () => {
    const events = [
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "done", finishReason: "stop", ...responseMetadata() },
    ];
    const encoded = new TextEncoder().encode(events.map((event) =>
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 17));
        controller.enqueue(encoded.slice(17, 61));
        controller.enqueue(encoded.slice(61));
        controller.close();
      },
    });
    const result = await clRouterGenerateStream(
      { task: "chat", messages: [{ role: "user", content: "Hello" }] },
      {
        environment,
        fetch: vi.fn(async () => new Response(body, {
          headers: { "content-type": "text/event-stream" },
        })),
      },
    );
    const received = [];
    for await (const event of result.events) received.push(event);
    expect(received).toEqual(events);
  });

  test("validates embedding vectors", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ...responseMetadata(),
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
    }));
    await expect(clRouterEmbed(
      { texts: ["one", "two"], dimensions: 2 },
      { environment, fetch: fetchMock },
    )).resolves.toMatchObject({ embeddings: [[0.1, 0.2], [0.3, 0.4]] });
  });

  test("sends transcription metadata separately from file bytes", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ...responseMetadata(),
      text: "Bound policy transcript.",
    }));
    await clRouterTranscribe({
      orgId: "org-1",
      data: new Uint8Array([1, 2, 3]),
      filename: "memo.m4a",
      mediaType: "audio/mp4",
      trace: { parentRequestId: "parent-1" },
    }, { environment, fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://router.example.test/v1/transcribe");
    const form = init.body as FormData;
    expect(JSON.parse(String(form.get("request")))).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      filename: "memo.m4a",
      mediaType: "audio/mp4",
      trace: { parentRequestId: "parent-1" },
    });
    expect((form.get("file") as File).name).toBe("memo.m4a");
  });

  test("sends idempotent feedback against the originating router request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accepted: true, duplicate: false }));
    await sendClRouterFeedback({
      requestId: "request-1",
      idempotencyKey: "review-1",
      signals: { reviewCorrectionCount: 2, reviewedFieldCount: 8 },
      trace: { parentRequestId: "parent-1" },
    }, { environment, fetch: fetchMock });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      tenantId: "glass",
      requestId: "request-1",
      idempotencyKey: "review-1",
      trace: { parentRequestId: "parent-1" },
    });
  });
});

describe("cl-router direct fallback boundary", () => {
  test("allows only connection, timeout, and server errors", () => {
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("connection", "down"))).toBe(true);
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("timeout", "slow"))).toBe(true);
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("server", "bad", { status: 503 }))).toBe(true);
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("client", "bad", { status: 401 }))).toBe(false);
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("configuration", "missing"))).toBe(false);
    expect(isClRouterDirectFallbackError(new ClRouterRequestError("invalid_response", "bad"))).toBe(false);
  });

  test("falls back after a connection failure", async () => {
    const direct = vi.fn(async () => "direct");
    await expect(withClRouterDirectFallback({
      router: async () => {
        throw new ClRouterRequestError("connection", "down");
      },
      direct,
    })).resolves.toBe("direct");
    expect(direct).toHaveBeenCalledOnce();
  });

  test("does not fall back after a 4xx response", async () => {
    const direct = vi.fn(async () => "direct");
    await expect(withClRouterDirectFallback({
      router: () => clRouterGenerate(
        { task: "classification", prompt: "test" },
        {
          environment,
          fetch: vi.fn(async () => new Response(null, { status: 401 })),
        },
      ).then(() => "router"),
      direct,
    })).rejects.toMatchObject({ kind: "client", status: 401 });
    expect(direct).not.toHaveBeenCalled();
  });
});
