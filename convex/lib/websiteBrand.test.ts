import { describe, expect, it } from "vitest";
import {
  extractImageBrandColors,
  extractWebsiteBrandColors,
  extractWebsiteStylesheetUrls,
  normalizePublicWebsiteUrl,
} from "./websiteBrand";

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

  it("uses saturated favicon pixels as primary brand-color evidence", async () => {
    const svg = new TextEncoder().encode(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
        <rect width="32" height="32" fill="#FF4E00" />
      </svg>
    `);

    expect(await extractImageBrandColors(svg)).toEqual(["#FF4E00"]);
  });
});
