import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function declarations(selector: ":root" | ".dark") {
  const escaped = selector.replace(".", "\\.");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`Missing ${selector} theme block`);

  return new Map(
    Array.from(block[1].matchAll(/--([\w-]+):\s*([^;]+);/g), (match) => [
      match[1],
      match[2].trim(),
    ] as const),
  );
}

function alpha(value: string | undefined) {
  const match = value?.match(/,\s*([\d.]+)\)$/);
  if (!match) throw new Error(`Expected rgba color, received ${value}`);
  return Number(match[1]);
}

function luminance(hex: string | undefined) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Expected six-digit hex color, received ${hex}`);
  }
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: string | undefined, second: string | undefined) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("browser theme contrast", () => {
  const light = declarations(":root");
  const dark = declarations(".dark");
  const borderTokens = [
    "border-subtle",
    "border",
    "input",
    "border-emphasized",
    "border-hover",
    "border-focus",
  ];

  it("uses layered non-black dark surfaces with readable text", () => {
    for (const token of ["background", "card", "popover", "sidebar"]) {
      expect(dark.get(token)).not.toBe("#000000");
    }
    expect(
      new Set([
        dark.get("background"),
        dark.get("card"),
        dark.get("popover"),
      ]).size,
    ).toBe(3);
    expect(
      contrast(dark.get("foreground"), dark.get("background")),
    ).toBeGreaterThan(7);
    expect(
      contrast(dark.get("muted-foreground"), dark.get("background")),
    ).toBeGreaterThan(4.5);
  });

  it("makes every neutral border tier stronger in dark mode", () => {
    for (const token of borderTokens) {
      expect(alpha(dark.get(token))).toBeGreaterThan(alpha(light.get(token)));
    }
    const darkStrengths = borderTokens.map((token) => alpha(dark.get(token)));
    expect(darkStrengths).toEqual([...darkStrengths].sort((a, b) => a - b));
  });
});
