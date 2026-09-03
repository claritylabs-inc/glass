import { describe, expect, test, vi } from "vitest";
import {
  ClRouterRequestError,
  clRouterGenerate,
  withClRouterDirectFallback,
} from "./clRouterClient";

const environment = {
  CL_ROUTER_URL: "https://router.example.test/",
  CL_ROUTER_SECRET: "router-secret",
  SPOT_ENV: "production",
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
      executionBudgetMs: 179_000,
      orgId: "org-1",
      prompt: "Classify this policy delivery request.",
      trace: { traceId: "trace-1", parentRequestId: "parent-1" },
      settings: {
        providerKeys: { openai: "broker-openai-key" },
      },
    });
  });

  test("preserves typed router failure metadata", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      error: {
        code: "router_unavailable",
        message: "No eligible route is available.",
        retryable: true,
        executionStarted: false,
        requestId: "failed-request",
        attempts: [{
          attempt: 1,
          provider: "fireworks",
          model: "accounts/fireworks/models/deepseek-v4-flash-0731",
          outcome: "timeout",
          errorCode: "provider_timeout",
        }],
      },
    }, { status: 503 }));

    await expect(clRouterGenerate(
      { task: "extraction", prompt: "Extract." },
      { environment, fetch: fetchMock },
    )).rejects.toMatchObject({
      kind: "server",
      status: 503,
      routerCode: "router_unavailable",
      retryable: true,
      executionStarted: false,
      requestId: "failed-request",
      attempts: [{
        attempt: 1,
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash-0731",
        outcome: "timeout",
        errorCode: "provider_timeout",
      }],
    });
  });

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
});

describe("cl-router direct fallback boundary", () => {

  test("falls back after a typed pre-execution production outage", async () => {
    const direct = vi.fn(async () => "direct");
    await expect(withClRouterDirectFallback({
      router: async () => {
        throw new ClRouterRequestError("server", "down", {
          status: 503,
          routerCode: "router_unavailable",
          retryable: true,
          executionStarted: false,
        });
      },
      direct,
      environment,
    })).resolves.toBe("direct");
    expect(direct).toHaveBeenCalledOnce();
  });
});
