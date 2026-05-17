/// <reference types="vite/client" />
// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateStructuredWithFallback: vi.fn(),
}));

vi.mock("./models", () => ({
  getModel: vi.fn(() => "model"),
  getModelAndRouteForOrg: vi.fn(async () => ({ model: "org-model", route: { provider: "openai", model: "org-model" } })),
  getProviderOptionsForTask: vi.fn(() => ({})),
  generateStructuredWithFallback: mocks.generateStructuredWithFallback,
  generateTextWithFallback: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } })),
  mergeProviderOptions: vi.fn((a, b) => ({ ...(a ?? {}), ...(b ?? {}) })),
  modelTaskForCall: vi.fn((task) => task),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, Output: { object: vi.fn((value) => value) } };
});

import { makeGenerateObject } from "./sdkCallbacks";

describe("sdkCallbacks PDF inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateStructuredWithFallback.mockResolvedValue({ output: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });
  });

  test("keeps PDF file parts for extraction callbacks", async () => {
    const generateObject = makeGenerateObject("extraction", { ctx: { runQuery: vi.fn() } as any, orgId: "org" as any });

    await generateObject({
      prompt: "Extract",
      system: "sys",
      schema: {} as any,
      maxTokens: 100,
      providerOptions: { pdfBytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" } as any,
    });

    const input = mocks.generateStructuredWithFallback.mock.calls[0][0];
    expect(input.messages[0].content.some((part: any) => part.type === "file")).toBe(true);
    expect(input.providerOptions.pdfBytes).toBeInstanceOf(Uint8Array);
  });
});
