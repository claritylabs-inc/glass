import { afterEach, describe, expect, test, vi } from "vitest";
import { stepCountIs, streamText, tool } from "ai";
import {
  MockLanguageModelV3,
  convertArrayToReadableStream,
} from "ai/test";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { z } from "zod";
import {
  ClRouterVisibleOutputError,
  createClRouterLanguageModel,
} from "./clRouterLanguageModel";

const environment = {
  CL_ROUTER_URL: "https://router.example.test",
  CL_ROUTER_SECRET: "router-secret",
};

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function doneEvent(finishReason: string) {
  return {
    type: "done",
    finishReason,
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5.5" },
    routing: {
      decision: "policy",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5.5" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: true,
      routeSource: "broker",
      attemptCount: 1,
    },
    usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 2, cacheWriteTokens: 1 },
    costUsd: 0.001,
    costStatus: "priced",
  };
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => {
    const type = (event as { type: string }).type;
    return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  }).join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function directStream(text: string) {
  return {
    stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "direct-text" },
      { type: "text-delta", id: "direct-text", delta: text },
      { type: "text-end", id: "direct-text" },
      {
        type: "finish",
        usage,
        finishReason: { unified: "stop", raw: "stop" },
      },
    ]),
  };
}

function adapterOptions(
  directModel: MockLanguageModelV3,
  fetch: typeof globalThis.fetch,
) {
  return {
    task: "chat" as const,
    taskKind: "query_reason",
    orgId: "org-1",
    settings: {
      routes: { chat: { provider: "openai" as const, model: "gpt-5.5" } },
      routeSources: { chat: "broker" },
      providerKeys: { openai: "broker-openai-key" },
    },
    sessionKey: "thread-1",
    trace: {
      traceId: "agent-message-1",
      parentRequestId: "user-message-1",
      channel: "web",
    },
    directModel,
    client: { environment, fetch },
  };
}

function rawCallOptions(): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  };
}

describe("cl-router LanguageModelV3 adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("preserves the AI SDK tool loop across router model steps", async () => {
    const execute = vi.fn(async ({ policyNumber }: { policyNumber: string }) => ({
      carrier: "Acme",
      policyNumber,
    }));
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(sseResponse([
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "lookup_policy",
          input: { policyNumber: "GL-100" },
        },
        doneEvent("tool-calls"),
      ]))
      .mockResolvedValueOnce(sseResponse([
        { type: "text-delta", id: "text-2", delta: "Acme policy found." },
        doneEvent("stop"),
      ]));
    const directModel = new MockLanguageModelV3();
    const model = createClRouterLanguageModel(adapterOptions(directModel, fetchMock));

    const result = streamText({
      model,
      system: "Use the policy tool before answering.",
      prompt: "Find GL-100.",
      tools: {
        lookup_policy: tool({
          description: "Look up a bound policy",
          inputSchema: z.object({ policyNumber: z.string() }),
          execute,
        }),
      },
      stopWhen: stepCountIs(2),
    });

    await expect(result.text).resolves.toBe("Acme policy found.");
    expect(execute).toHaveBeenCalledWith(
      { policyNumber: "GL-100" },
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(firstRequest).toMatchObject({
      tenantId: "glass",
      task: "chat",
      taskKind: "query_reason",
      orgId: "org-1",
      sessionKey: "thread-1",
      tools: [{ name: "lookup_policy", description: "Look up a bound policy" }],
      trace: {
        traceId: "agent-message-1",
        parentRequestId: "user-message-1",
      },
      settings: { providerKeys: { openai: "broker-openai-key" } },
      routing: { allowFallback: true },
    });
    expect(firstRequest.routing).not.toHaveProperty("pin");
    expect(firstRequest.messages[0]).toEqual({
      role: "system",
      content: "Use the policy tool before answering.",
    });

    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(secondRequest.trace.parentRequestId).toBe("request-1");
    expect(secondRequest.routing).toEqual({
      pin: { provider: "openai", model: "gpt-5.5" },
      allowFallback: false,
    });
    expect(secondRequest.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup_policy",
              input: { policyNumber: "GL-100" },
            }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "lookup_policy",
            }),
          ]),
        }),
      ]),
    );
    expect(directModel.doStreamCalls).toHaveLength(0);
  });

  test("uses the direct model for an HTTP 5xx before router output", async () => {
    const directModel = new MockLanguageModelV3({
      doStream: directStream("Direct answer."),
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 503 }),
    );
    const model = createClRouterLanguageModel(
      adapterOptions(directModel, fetchMock),
    );

    const result = streamText({ model, prompt: "Hello" });
    await expect(result.text).resolves.toBe("Direct answer.");
    expect(directModel.doStreamCalls).toHaveLength(1);
  });

  test("keeps the entire run on the direct model after initial router fallback", async () => {
    const directModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "Direct answer." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 503 }),
    );
    const model = createClRouterLanguageModel(
      adapterOptions(directModel, fetchMock),
    );

    await model.doGenerate(rawCallOptions());
    await model.doGenerate(rawCallOptions());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(directModel.doGenerateCalls).toHaveLength(2);
  });

  test("fails closed instead of changing transport after a successful router step", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...doneEvent("stop"),
          output: "First step",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const directModel = new MockLanguageModelV3();
    const model = createClRouterLanguageModel(
      adapterOptions(directModel, fetchMock),
    );

    await model.doGenerate(rawCallOptions());
    await expect(model.doGenerate(rawCallOptions())).rejects.toThrow(
      "HTTP 503",
    );

    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(secondRequest.routing).toEqual({
      pin: { provider: "openai", model: "gpt-5.5" },
      allowFallback: false,
    });
    expect(directModel.doGenerateCalls).toHaveLength(0);
  });

  test("uses the direct model for a retryable SSE failure before router output", async () => {
    const directModel = new MockLanguageModelV3({ doStream: directStream("Direct answer.") });
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => sseResponse([{
      type: "error",
      error: {
        code: "stream_failed",
        message: "The model stream failed.",
        retryable: true,
      },
    }]));
    const model = createClRouterLanguageModel(adapterOptions(directModel, fetchMock));

    const result = streamText({ model, prompt: "Hello" });
    await expect(result.text).resolves.toBe("Direct answer.");
    expect(directModel.doStreamCalls).toHaveLength(1);
  });

  test("fails closed on auth and malformed successful responses", async () => {
    const directModel = new MockLanguageModelV3({ doStream: directStream("Direct answer.") });
    const unauthorized = createClRouterLanguageModel(adapterOptions(
      directModel,
      vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 })),
    ));
    await expect(unauthorized.doStream(rawCallOptions())).rejects.toThrow("HTTP 401");

    const malformed = createClRouterLanguageModel(adapterOptions(
      directModel,
      vi.fn<typeof globalThis.fetch>(async () => new Response("not sse", {
        headers: { "content-type": "application/json" },
      })),
    ));
    await expect(malformed.doStream(rawCallOptions())).rejects.toThrow("non-SSE");
    expect(directModel.doStreamCalls).toHaveLength(0);
  });

  test("never falls back after a visible router text delta", async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount++ === 0) {
          controller.enqueue(encoder.encode(
            `event: text-delta\ndata: ${JSON.stringify({
              type: "text-delta",
              id: "text-1",
              delta: "Visible router output",
            })}\n\n`,
          ));
          return;
        }
        controller.error(new TypeError("socket reset"));
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const directModel = new MockLanguageModelV3({ doStream: directStream("Direct answer.") });
    const model = createClRouterLanguageModel(adapterOptions(
      directModel,
      vi.fn<typeof globalThis.fetch>(async () => response),
    ));
    const result = await model.doStream(rawCallOptions());
    const reader = result.stream.getReader();
    const parts: LanguageModelV3StreamPart[] = [];
    let streamError: unknown;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    } catch (error) {
      streamError = error;
    }

    expect(parts).toContainEqual({
      type: "text-delta",
      id: "text-1",
      delta: "Visible router output",
    });
    expect(streamError).toBeInstanceOf(ClRouterVisibleOutputError);
    expect(directModel.doStreamCalls).toHaveLength(0);
  });

  test("falls back when the router connection drops before visible output", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("socket reset"));
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const directModel = new MockLanguageModelV3({ doStream: directStream("Direct answer.") });
    const model = createClRouterLanguageModel(adapterOptions(
      directModel,
      vi.fn<typeof globalThis.fetch>(async () => response),
    ));

    const result = streamText({ model, prompt: "Hello" });
    await expect(result.text).resolves.toBe("Direct answer.");
    expect(directModel.doStreamCalls).toHaveLength(1);
  });
});
