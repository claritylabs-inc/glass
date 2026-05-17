/// <reference types="vite/client" />
// @vitest-environment node
import { createHash, createHmac } from "crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parsePdf } from "./docling";

describe("parsePdf", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("signs and parses a successful response", async () => {
    vi.stubEnv("DOCLING_URL", "https://docling.example");
    vi.stubEnv("DOCLING_HMAC_SECRET", "secret");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ markdown: "# Parsed", docTagsJson: { ok: true }, parserVersion: "docling-test", parsingMs: 42 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new TextEncoder().encode("%PDF-test");
    await expect(parsePdf({ pdfBytes: bytes })).resolves.toMatchObject({ markdown: "# Parsed" });

    const [, init] = fetchMock.mock.calls[0];
    const timestamp = init.headers["X-Docling-Timestamp"];
    const bodyHash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const expectedSignature = createHmac("sha256", "secret").update(`${timestamp}.${bodyHash}`).digest("hex");
    expect(init.headers["X-Docling-Signature"]).toBe(expectedSignature);
  });

  test("sanitizes Docling JSON keys reserved by Convex", async () => {
    vi.stubEnv("DOCLING_URL", "https://docling.example");
    vi.stubEnv("DOCLING_HMAC_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        markdown: "# Parsed",
        docTagsJson: {
          "$ref": "#/texts/0",
          nested: [{ "$schema": "docling" }],
        },
      }),
    }));

    await expect(parsePdf({ pdfBytes: new Uint8Array([1]) })).resolves.toMatchObject({
      docTagsJson: {
        docling_ref: "#/texts/0",
        nested: [{ docling_schema: "docling" }],
      },
    });
  });

  test("fails fast when env is missing", async () => {
    await expect(parsePdf({ pdfBytes: new Uint8Array([1]) })).rejects.toThrow("DOCLING_URL");
  });

  test("rejects bad response shape", async () => {
    vi.stubEnv("DOCLING_URL", "https://docling.example");
    vi.stubEnv("DOCLING_HMAC_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await expect(parsePdf({ pdfBytes: new Uint8Array([1]) })).rejects.toThrow("markdown");
  });

  test("retries once on 5xx", async () => {
    vi.stubEnv("DOCLING_URL", "https://docling.example");
    vi.stubEnv("DOCLING_HMAC_SECRET", "secret");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "busy" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ markdown: "ok" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(parsePdf({ pdfBytes: new Uint8Array([1]) })).resolves.toMatchObject({ markdown: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
