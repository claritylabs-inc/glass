import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("modal motion", () => {
  it("keeps shared modal backdrops unblurred", () => {
    const dialog = read("components/ui/dialog.tsx");
    const sheet = read("components/ui/sheet.tsx");

    expect(dialog).not.toContain("backdrop-blur");
    expect(dialog).not.toContain("supports-backdrop-filter");
    expect(sheet).not.toContain("backdrop-blur");
    expect(sheet).not.toContain("supports-backdrop-filter");
  });

  it("uses short linear opacity and transform transitions", () => {
    const dialog = read("components/ui/dialog.tsx");
    const sheet = read("components/ui/sheet.tsx");
    const sharedModalPrimitives = `${dialog}\n${sheet}`;

    expect(dialog).toContain("transition-opacity duration-75 ease-linear");
    expect(dialog).toContain(
      "transition-[opacity,transform] duration-75 ease-linear",
    );
    expect(sheet).toContain("transition-opacity duration-75 ease-linear");
    expect(sheet).toContain(
      "transition-[opacity,transform] duration-100 ease-linear",
    );
    expect(sharedModalPrimitives).not.toMatch(
      /\b(?:animate-in|animate-out|fade-in-0|fade-out-0)\b/,
    );
  });
});
