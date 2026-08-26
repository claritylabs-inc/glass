import { afterEach, describe, expect, it, vi } from "vitest";
const { undiciFetchMock } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(),
}));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: undiciFetchMock };
});
import { encode } from "fast-png";
import {
  extractImageBrandColors,
  extractWebsiteIdentityEvidence,
  extractWebsiteSiteName,
  extractWebsiteStylesheetUrls,
  hasSafeFaviconDimensions,
  hasSafePngDimensions,
  normalizePublicWebsiteUrl,
  readResponseBytesWithinLimit,
  readWebsiteFaviconSignals,
  resolvePublicAddress,
} from "./websiteBrand";

afterEach(() => {
  vi.unstubAllGlobals();
  undiciFetchMock.mockReset();
});

describe("website brand signals", () => {
  it("accepts public websites and rejects private network targets", () => {
    expect(normalizePublicWebsiteUrl("allstate.com")).toBe(
      "https://allstate.com/",
    );
    expect(() => normalizePublicWebsiteUrl("http://127.0.0.1")).toThrow(
      "Private network",
    );
    for (const address of [
      "100.64.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
    ]) {
      expect(() => normalizePublicWebsiteUrl(`http://${address}`)).toThrow(
        "Private network",
      );
    }
    expect(() => normalizePublicWebsiteUrl("http://[::1]")).toThrow(
      "Private network",
    );
    expect(() => normalizePublicWebsiteUrl("http://[fc00::1]")).toThrow(
      "Private network",
    );
    expect(() => normalizePublicWebsiteUrl("http://[fe80::1]")).toThrow(
      "Private network",
    );
    expect(() => normalizePublicWebsiteUrl("http://[2001:db8::1]")).toThrow(
      "Private network",
    );
    expect(
      normalizePublicWebsiteUrl("https://[2606:4700:4700::1111]"),
    ).toBe("https://[2606:4700:4700::1111]/");
  });

  it("rejects any hostname with a non-public DNS answer", async () => {
    await expect(
      resolvePublicAddress("carrier.example", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("Private network");
    await expect(
      resolvePublicAddress("carrier.example", async () => [
        { address: "2606:4700:4700::1111", family: 6 },
      ]),
    ).resolves.toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });

  it("rejects declared and streamed bodies above the byte limit", async () => {
    const declared = new Response("not read", {
      headers: { "content-length": "5" },
    });
    await expect(readResponseBytesWithinLimit(declared, 4)).rejects.toThrow(
      "exceeded 4 bytes",
    );

    const streamed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5]));
          controller.close();
        },
      }),
    );
    await expect(readResponseBytesWithinLimit(streamed, 4)).rejects.toThrow(
      "exceeded 4 bytes",
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

  it("rejects compressed PNGs whose headers declare unsafe allocations", async () => {
    const favicon = encode({
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array(16),
    });
    const unsafe = favicon.slice();
    const view = new DataView(
      unsafe.buffer,
      unsafe.byteOffset,
      unsafe.byteLength,
    );
    view.setUint32(16, 65_535);
    view.setUint32(20, 65_535);

    expect(hasSafePngDimensions(unsafe)).toBe(false);
    expect(hasSafeFaviconDimensions(unsafe)).toBe(false);
    expect(await extractImageBrandColors(unsafe)).toEqual([]);

    const unsafeIco = new Uint8Array(22 + unsafe.byteLength);
    const icoView = new DataView(unsafeIco.buffer);
    icoView.setUint16(2, 1, true);
    icoView.setUint16(4, 1, true);
    unsafeIco[6] = 2;
    unsafeIco[7] = 2;
    icoView.setUint32(14, unsafe.byteLength, true);
    icoView.setUint32(18, 22, true);
    unsafeIco.set(unsafe, 22);

    expect(hasSafeFaviconDimensions(unsafeIco)).toBe(false);
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
    undiciFetchMock.mockImplementation(async (
      value: string | URL | Request,
    ) => {
      const url = String(value);
      if (url === "https://93.184.216.34/") {
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

    const signals = await readWebsiteFaviconSignals(
      "https://93.184.216.34/",
    );

    expect(signals.favicon).toBeInstanceOf(Blob);
    expect(signals.colorCandidates).toEqual(["#1434CB"]);
    expect(undiciFetchMock).toHaveBeenCalledWith(
      "https://93.184.216.34/favicon.ico",
      expect.any(Object),
    );
    const faviconRequest = undiciFetchMock.mock.calls.find(
      ([value]) => String(value).endsWith("/favicon.ico"),
    );
    expect(faviconRequest?.[1]).toMatchObject({
      dispatcher: expect.any(Object),
      redirect: "manual",
    });
  });
});
