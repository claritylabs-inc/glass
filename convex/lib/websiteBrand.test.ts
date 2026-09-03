import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import {
  extractImageBrandColors,
  hasSafeFaviconDimensions,
  hasSafePngDimensions,
  normalizePublicWebsiteUrl,
  resolvePublicAddress,
} from "./websiteBrand";

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

});
