import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Spot domain migration", () => {
  it("permanently redirects every legacy application host to app.spot.insure", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          has: [{ type: "host", value: "app.glass.insure" }],
          destination: "https://app.spot.insure/:path*",
          permanent: true,
        }),
        expect.objectContaining({
          has: [{ type: "host", value: "glass.claritylabs.inc" }],
          destination: "https://app.spot.insure/:path*",
          permanent: true,
        }),
        expect.objectContaining({
          has: [{ type: "host", value: "spot.claritylabs.inc" }],
          destination: "https://app.spot.insure/:path*",
          permanent: true,
        }),
      ]),
    );
  });

  it("keeps legacy icon URLs resolvable through Spot assets", async () => {
    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toEqual(
      expect.arrayContaining([
        {
          source: "/glass-icon.jpg",
          destination: "/spot-icon.jpg",
        },
        {
          source: "/glass-icon.svg",
          destination: "/spot-icon.svg",
        },
      ]),
    );
  });
});
