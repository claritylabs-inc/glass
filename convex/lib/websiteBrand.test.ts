import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "fast-png";
import {
  extractImageBrandColors,
  extractWebsiteBrandColors,
  extractWebsiteIdentityEvidence,
  extractWebsiteSiteName,
  extractWebsiteStylesheetUrls,
  normalizePublicWebsiteUrl,
  readWebsiteFaviconSignals,
} from "./websiteBrand";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("website brand signals", () => {
  it("prioritizes useful website theme and stylesheet colors", () => {
    const colors = extractWebsiteBrandColors(`
      <meta name="theme-color" content="#1434CB">
      <style>
        :root { --brand: #1434CB; --accent: #22A6B3; --paper: #ffffff; }
      </style>
    `);

    expect(colors.slice(0, 2)).toEqual(["#1434CB", "#22A6B3"]);
    expect(colors).not.toContain("#FFFFFF");
  });

  it("accepts public websites and rejects private network targets", () => {
    expect(normalizePublicWebsiteUrl("allstate.com")).toBe(
      "https://allstate.com/",
    );
    expect(() => normalizePublicWebsiteUrl("http://127.0.0.1")).toThrow(
      "Private network",
    );
  });

  it("discovers linked public stylesheets for brand color evidence", () => {
    expect(
      extractWebsiteStylesheetUrls(
        '<link rel="stylesheet" href="/assets/brand.css">',
        "https://markel.com/",
      ),
    ).toEqual(["https://markel.com/assets/brand.css"]);
  });

  it("reads the public brand name advertised by the official site", () => {
    expect(
      extractWebsiteSiteName(
        '<meta property="og:site_name" content="Liberty Specialty Markets">',
      ),
    ).toBe("Liberty Specialty Markets");
  });

  it("retains bounded first-party carrier relationship evidence", () => {
    expect(
      extractWebsiteIdentityEvidence(`
        <main>
          Liberty Specialty Markets is a trading name for Liberty Managing
          Agency Limited, for and on behalf of Syndicate 4472 at Lloyd's.
        </main>
      `),
    ).toContain(
      "Liberty Specialty Markets is a trading name for Liberty Managing Agency Limited",
    );
  });

  it("uses saturated favicon pixels as primary brand-color evidence", async () => {
    const favicon = encode({
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array([
        255, 78, 0, 255, 255, 78, 0, 255, 255, 78, 0, 255, 255, 78, 0, 255,
      ]),
    });

    expect(await extractImageBrandColors(favicon)).toEqual(["#FF4E00"]);
  });

  it("recovers a canonical domain favicon and color when website HTML is blocked", async () => {
    const favicon = encode({
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array([
        20, 52, 203, 255, 20, 52, 203, 255, 20, 52, 203, 255, 20, 52, 203,
        255,
      ]),
    });
    const fetchMock = vi.fn(async (value: string | URL | Request) => {
      const url = String(value);
      if (url === "https://blocked.example/") {
        return new Response("Forbidden", { status: 403 });
      }
      if (url.endsWith("/apple-touch-icon.png")) {
        return new Response("Not found", { status: 404 });
      }
      if (url.endsWith("/favicon.ico")) {
        const body = favicon.buffer.slice(
          favicon.byteOffset,
          favicon.byteOffset + favicon.byteLength,
        ) as ArrayBuffer;
        return new Response(body, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const signals = await readWebsiteFaviconSignals(
      "https://blocked.example/",
    );

    expect(signals.favicon).toBeInstanceOf(Blob);
    expect(signals.colorCandidates).toEqual(["#1434CB"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://blocked.example/favicon.ico",
      expect.any(Object),
    );
  });
});
