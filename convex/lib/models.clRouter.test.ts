import { afterEach, describe, expect, test, vi } from "vitest";
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import {
  generateObjectForOrg,
  generateObjectForPublicTask,
  generateAgentTextForOrg,
  generateTextForOrg,
  generateTextForPublicTask,
  getModelAndRouteForSettingsSnapshot,
} from "./models";

function routerResponse(output: unknown) {
  return {
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5-mini" },
    routing: {
      decision: "snapshot",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5-mini" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "broker",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 4,
      cacheWriteTokens: 3,
    },
    costUsd: 0.0002,
    costStatus: "priced",
    output,
    finishReason: "stop",
  };
}

function routerContext() {
  return {
    runQuery: vi.fn(async () => ({
      routes: {
        chat: { provider: "openai", model: "gpt-5-mini" },
        classification: { provider: "openai", model: "gpt-5-mini" },
      },
      routeSources: { chat: "broker", classification: "broker" },
      providerKeys: { openai: "broker-openai-key" },
    })),
    runMutation: vi.fn(async () => null),
  };
}

describe("Convex cl-router generation integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("reuses resolved broker and global snapshot precedence for direct fallback", () => {
    const resolved = getModelAndRouteForSettingsSnapshot({
      routes: {
        classification: { provider: "openai", model: "gpt-5-mini" },
        extraction_quality: {
          provider: "fireworks",
          model: "accounts/fireworks/models/deepseek-v4-flash",
        },
        extraction_coverage_cleanup: { provider: "openai", model: "gpt-5.4-mini" },
      },
      routeSources: {
        classification: "broker",
        extraction_quality: "global",
        extraction_coverage_cleanup: "static",
      },
      providerKeys: { openai: "broker-openai-key" },
    }, "classification");

    expect(resolved).toMatchObject({
      route: { provider: "openai", model: "gpt-5-mini" },
      routeSource: "broker",
      qualityRouteSource: "global",
      coverageCleanupRouteSource: "static",
      transport: "direct",
    });
  });

  test("routes structured classification with the Convex settings snapshot", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "classification");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(routerResponse({
      disposition: "deliver",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = routerContext();

    const result = await generateObjectForOrg(
      ctx as never,
      "org-1" as Id<"organizations">,
      "classification",
      {
        schema: z.object({ disposition: z.enum(["deliver", "hold"]) }),
        system: "Classify conservatively.",
        prompt: "Should this policy be delivered?",
        maxOutputTokens: 80,
      },
      { taskKind: "policy_delivery" },
    );

    expect(result).toMatchObject({
      object: { disposition: "deliver" },
      route: { provider: "openai", model: "gpt-5-mini" },
      routeSource: "broker",
      transport: "cl-router",
      usage: {
        inputTokens: 20,
        inputTokenDetails: {
          noCacheTokens: 13,
          cacheReadTokens: 4,
          cacheWriteTokens: 3,
        },
        outputTokens: 5,
        cachedInputTokens: 4,
      },
      clRouter: {
        requestId: "request-1",
        routing: { policyVersion: "policy-v1" },
      },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      task: "classification",
      taskKind: "policy_delivery",
      maxTokens: 80,
      settings: {
        providerKeys: { openai: "broker-openai-key" },
      },
      trace: {
        label: "convex.models.generateObjectForOrg",
        taskKind: "policy_delivery",
      },
    });
  });

  test("routes simple message-based text classification", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "classification");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(routerResponse("deliver")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateTextForOrg(
      routerContext() as never,
      "org-1" as Id<"organizations">,
      "classification",
      {
        messages: [{ role: "user", content: "Classify this delivery." }],
        maxOutputTokens: 16,
      },
    );

    expect(result).toMatchObject({
      text: "deliver",
      transport: "cl-router",
      clRouter: { requestId: "request-1" },
    });
  });

  test("routes org tool loops through the shared agent adapter and pins later steps", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "chat");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        Response.json({
          ...routerResponse({
            text: "",
            toolCalls: [
              {
                toolCallId: "call-1",
                toolName: "lookup_policy",
                input: { policyNumber: "GL-100" },
              },
            ],
          }),
          finishReason: "tool-calls",
        }),
      )
      .mockImplementationOnce(async () =>
        Response.json({
          ...routerResponse("Acme policy found."),
          requestId: "request-2",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn(async () => ({ carrier: "Acme" }));

    const result = await generateAgentTextForOrg(
      routerContext() as never,
      "org-1" as Id<"organizations">,
      "chat",
      {
        prompt: "Find GL-100.",
        tools: {
          lookup_policy: tool({
            inputSchema: z.object({ policyNumber: z.string() }),
            execute,
          }),
        },
        stopWhen: stepCountIs(2),
      },
      {
        taskKind: "query_reason",
        sessionKey: "thread-1",
        trace: {
          traceId: "agent-message-1",
          parentRequestId: "user-message-1",
          label: "test.agent",
          phase: "query_reason",
          channel: "mcp",
        },
      },
    );

    expect(result.text).toBe("Acme policy found.");
    expect(execute).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(firstRequest.routing).toEqual({ allowFallback: true });
    expect(secondRequest.routing).toEqual({
      pin: { provider: "openai", model: "gpt-5-mini" },
      allowFallback: false,
    });
    expect(secondRequest.trace.parentRequestId).toBe("request-1");
  });

  test("fails closed instead of silently bypassing an enabled router task with tools", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "classification");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = routerContext();

    await expect(generateTextForOrg(
      ctx as never,
      "org-1" as Id<"organizations">,
      "classification",
      {
        prompt: "Classify this delivery.",
        tools: {
          classify_delivery: tool({
            description: "Classify the delivery",
            inputSchema: z.object({ disposition: z.string() }),
          }),
        },
      },
    )).rejects.toMatchObject({
      name: "ClRouterRequestError",
      kind: "configuration",
      message: expect.stringContaining("cannot preserve"),
    });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails closed for public-channel tool loops until they use the language-model adapter", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "chat");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = routerContext();

    await expect(generateTextForPublicTask(
      ctx as never,
      "chat",
      {
        prompt: "Help this prospect.",
        tools: {
          collect_lead: tool({
            description: "Collect lead details",
            inputSchema: z.object({ email: z.string() }),
          }),
        },
      },
    )).rejects.toMatchObject({
      name: "ClRouterRequestError",
      kind: "configuration",
      message: expect.stringContaining("language-model tool loop"),
    });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails closed for unsupported structured-call options when the task-kind gate is enabled", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "query_classify");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = routerContext();

    await expect(generateObjectForOrg(
      ctx as never,
      "org-1" as Id<"organizations">,
      "classification",
      {
        schema: z.object({ disposition: z.string() }),
        prompt: "Classify this delivery.",
        temperature: 0,
      },
      { taskKind: "query_classify" },
    )).rejects.toMatchObject({
      name: "ClRouterRequestError",
      kind: "configuration",
      message: expect.stringContaining("query_classify"),
    });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards task kinds for public text and structured generation policies", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "query_classify");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => Response.json(routerResponse("public")))
      .mockImplementationOnce(async () => Response.json(routerResponse({ allowed: true })));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = routerContext();

    await generateTextForPublicTask(
      ctx as never,
      "classification",
      { prompt: "Classify public request.", maxOutputTokens: 16 },
      { taskKind: "query_classify" },
    );
    await generateObjectForPublicTask(
      ctx as never,
      "classification",
      {
        prompt: "Classify public request.",
        maxOutputTokens: 32,
        schema: z.object({ allowed: z.boolean() }),
      },
      { taskKind: "query_classify" },
    );

    for (const call of fetchMock.mock.calls) {
      const [, init] = call as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        task: "classification",
        taskKind: "query_classify",
        trace: { taskKind: "query_classify" },
      });
    }
  });
});
