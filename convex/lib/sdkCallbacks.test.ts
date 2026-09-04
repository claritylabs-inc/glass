/// <reference types="vite/client" />
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
  embedMany: vi.fn(async () => ({ embeddings: [[0.1, 0.2]] })),
  generateStructuredWithFallback: vi.fn(),
  getModelAndRouteForOrg: vi.fn(async () => ({
    model: "org-model",
    route: { provider: "openai", model: "org-model" },
  })),
  getModelAndRouteForSettingsSnapshot: vi.fn(() => ({
    model: "snapshot-model",
    route: { provider: "openai", model: "router-model" },
    routeSource: "org",
    transport: "direct",
  })),
  resolveClRouterSettingsForOrg: vi.fn(async () => ({
    routes: {
      extraction: { provider: "openai", model: "router-model" },
    },
    routeSources: { extraction: "org" },
    providerKeys: {},
  })),
}));

vi.mock("./models", () => ({
  getModel: vi.fn(() => "model"),
  getModelAndRouteForOrg: mocks.getModelAndRouteForOrg,
  getModelAndRouteForSettingsSnapshot: mocks.getModelAndRouteForSettingsSnapshot,
  getModelForRoute: vi.fn(() => "route-model"),
  getProviderOptionsForRoute: vi.fn(() => ({})),
  getProviderOptionsForTask: vi.fn(() => ({})),
  generateStructuredWithFallback: mocks.generateStructuredWithFallback,
  generateTextWithFallback: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } })),
  mergeProviderOptions: vi.fn((a, b) => ({ ...(a ?? {}), ...(b ?? {}) })),
  modelTaskForCall: vi.fn((task) => task),
  MODEL_ROUTING: {
    extraction: { provider: "openai", model: "static-extraction" },
    analysis: { provider: "openai", model: "static-analysis" },
  },
  primaryRouteForCall: vi.fn(() => null),
  resolveClRouterSettingsForOrg: mocks.resolveClRouterSettingsForOrg,
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    embed: mocks.embed,
    embedMany: mocks.embedMany,
    Output: { object: vi.fn((value) => value) },
  };
});

import { makeGenerateObject } from "./sdkCallbacks";

describe("sdkCallbacks PDF inputs", () => {
  const TestSchema = z.object({ ok: z.boolean().optional() });
  const mockActionCtx = (): ActionCtx => ({
    runQuery: vi.fn(async () => undefined) as ActionCtx["runQuery"],
    runMutation: vi.fn(async () => undefined) as ActionCtx["runMutation"],
    runAction: vi.fn(async () => undefined) as ActionCtx["runAction"],
    scheduler: {} as ActionCtx["scheduler"],
    auth: {} as ActionCtx["auth"],
    storage: {} as ActionCtx["storage"],
    vectorSearch: vi.fn(async () => []) as ActionCtx["vectorSearch"],
    meta: {} as ActionCtx["meta"],
  });
  const testRouting = () => ({
    ctx: mockActionCtx(),
    orgId: "org" as Id<"organizations">,
  });

  type GeneratedInput = {
    messages?: Array<{ content: Array<{ type: string }> }>;
    prompt?: string;
    providerOptions: Record<string, unknown>;
  };

  const generatedInput = () =>
    mocks.generateStructuredWithFallback.mock.calls[0][0] as GeneratedInput;

  const hasMessagePart = (input: GeneratedInput, type: string) =>
    input.messages?.[0]?.content.some((part) => part.type === type) ?? false;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAndRouteForOrg.mockResolvedValue({
      model: "org-model",
      route: { provider: "openai", model: "org-model" },
    });
    mocks.generateStructuredWithFallback.mockResolvedValue({ output: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("keeps PDF file parts for extraction callbacks", async () => {
    const generateObject = makeGenerateObject("extraction", testRouting());

    await generateObject({
      prompt: "Extract",
      system: "sys",
      schema: TestSchema,
      maxTokens: 100,
      providerOptions: { pdfBytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" },
    });

    const input = generatedInput();
    expect(hasMessagePart(input, "file")).toBe(true);
    expect(input.providerOptions.pdfBytes).toBeInstanceOf(Uint8Array);
  });

  test("fails closed when router output does not satisfy the requested schema", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "extraction");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      requestId: "request-invalid-output",
      model: { provider: "openai", model: "gpt-5.4-mini" },
      routing: {
        decision: "snapshot",
        candidatesConsidered: [{ provider: "openai", model: "gpt-5.4-mini" }],
        policyVersion: "policy-v1",
        cacheStickinessApplied: false,
        routeSource: "org",
        attemptCount: 1,
      },
      usage: { inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 },
      costUsd: null,
      costStatus: "unpriced",
      output: { ok: "not-a-boolean" },
    })));

    await expect(makeGenerateObject("extraction", testRouting())({
      prompt: "Extract",
      schema: TestSchema,
      maxTokens: 100,
    })).rejects.toMatchObject({ kind: "invalid_response" });

    expect(mocks.generateStructuredWithFallback).not.toHaveBeenCalled();
  });
});
