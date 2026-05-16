/// <reference types="vite/client" />
// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateStructuredWithFallback: vi.fn(),
  parsePdf: vi.fn(),
  isDoclingEnabled: vi.fn(),
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

vi.mock("./docling", () => ({ parsePdf: mocks.parsePdf }));
vi.mock("./featureFlags", () => ({ isDoclingEnabled: mocks.isDoclingEnabled }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, Output: { object: vi.fn((value) => value) } };
});

import { makeGenerateObject } from "./sdkCallbacks";

describe("sdkCallbacks Docling interception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateStructuredWithFallback.mockResolvedValue({ output: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });
    mocks.parsePdf.mockResolvedValue({ markdown: "# Docling markdown", parserVersion: "docling-test", parsingMs: 12 });
  });

  test("keeps PDF file parts when the flag is off", async () => {
    mocks.isDoclingEnabled.mockResolvedValue(false);
    const generateObject = makeGenerateObject("extraction", { ctx: { runQuery: vi.fn() } as any, orgId: "org" as any });

    await generateObject({
      prompt: "Extract",
      system: "sys",
      schema: {} as any,
      maxTokens: 100,
      providerOptions: { pdfBytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" } as any,
    });

    expect(mocks.parsePdf).not.toHaveBeenCalled();
    const input = mocks.generateStructuredWithFallback.mock.calls[0][0];
    expect(input.messages[0].content.some((part: any) => part.type === "file")).toBe(true);
  });

  test("replaces PDF file part with Docling markdown when enabled", async () => {
    mocks.isDoclingEnabled.mockResolvedValue(true);
    const metas: any[] = [];
    const generateObject = makeGenerateObject("extraction", {
      ctx: { runQuery: vi.fn() } as any,
      orgId: "org" as any,
      onDoclingMeta: (meta: any) => metas.push(meta),
    } as any);

    await generateObject({
      prompt: "Extract",
      system: "sys",
      schema: {} as any,
      maxTokens: 100,
      providerOptions: { pdfBytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" } as any,
    });

    const input = mocks.generateStructuredWithFallback.mock.calls[0][0];
    expect(input.prompt).toContain("# Docling markdown");
    expect(input.messages).toBeUndefined();
    expect(input.providerOptions.pdfBytes).toBeUndefined();
    expect(metas[0]).toMatchObject({ parserBackend: "docling", parserVersion: "docling-test", parsedMarkdown: "# Docling markdown" });
  });

  test("fails closed when Docling parsing fails", async () => {
    mocks.isDoclingEnabled.mockResolvedValue(true);
    mocks.parsePdf.mockRejectedValue(new Error("docling down"));
    const generateObject = makeGenerateObject("extraction", { ctx: { runQuery: vi.fn() } as any, orgId: "org" as any });

    await expect(generateObject({
      prompt: "Extract",
      system: "sys",
      schema: {} as any,
      maxTokens: 100,
      providerOptions: { pdfBytes: new Uint8Array([1, 2, 3]) } as any,
    })).rejects.toThrow("docling down");
    expect(mocks.generateStructuredWithFallback).not.toHaveBeenCalled();
  });
});
