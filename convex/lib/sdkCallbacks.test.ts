/// <reference types="vite/client" />
// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const mocks = vi.hoisted(() => ({
  generateStructuredWithFallback: vi.fn(),
  getModelAndRouteForOrg: vi.fn(async () => ({
    model: "org-model",
    route: { provider: "openai", model: "org-model" },
  })),
}));

vi.mock("./models", () => ({
  getModel: vi.fn(() => "model"),
  getModelAndRouteForOrg: mocks.getModelAndRouteForOrg,
  getModelForRoute: vi.fn(() => "route-model"),
  getProviderOptionsForRoute: vi.fn(() => ({})),
  getProviderOptionsForTask: vi.fn(() => ({})),
  generateStructuredWithFallback: mocks.generateStructuredWithFallback,
  generateTextWithFallback: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } })),
  mergeProviderOptions: vi.fn((a, b) => ({ ...(a ?? {}), ...(b ?? {}) })),
  modelTaskForCall: vi.fn((task) => task),
  primaryRouteForCall: vi.fn(() => null),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, Output: { object: vi.fn((value) => value) } };
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

  test("keeps page image parts for Fireworks Kimi extraction callbacks without raw PDF parts", async () => {
    mocks.getModelAndRouteForOrg.mockResolvedValueOnce({
      model: "kimi",
      route: { provider: "fireworks", model: "accounts/fireworks/models/kimi-k2p6" },
    });
    const generateObject = makeGenerateObject("extraction", testRouting());

    await generateObject({
      prompt: "Extract",
      system: "sys",
      schema: TestSchema,
      maxTokens: 100,
      providerOptions: {
        pdfBytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
        images: [{ imageBase64: "abc", mimeType: "image/png" }],
      },
    });

    const input = generatedInput();
    expect(hasMessagePart(input, "image")).toBe(true);
    expect(hasMessagePart(input, "file")).toBe(false);
    expect(input.providerOptions.pdfBytes).toBeInstanceOf(Uint8Array);
  });

  test("uses text-only prompt input for Fireworks GLM callbacks", async () => {
    mocks.getModelAndRouteForOrg.mockResolvedValueOnce({
      model: "glm",
      route: { provider: "fireworks", model: "accounts/fireworks/models/glm-5p2" },
    });
    const generateObject = makeGenerateObject("analysis", testRouting());

    await generateObject({
      prompt: "Review",
      system: "sys",
      schema: TestSchema,
      maxTokens: 100,
      providerOptions: {
        pdfBytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
        images: [{ imageBase64: "abc", mimeType: "image/png" }],
      },
    });

    const input = generatedInput();
    expect(input.prompt).toBe("Review");
    expect(input.messages).toBeUndefined();
    expect(input.providerOptions.pdfBytes).toBeInstanceOf(Uint8Array);
  });
});
