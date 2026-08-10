import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".tsx") ? [path] : [];
    },
  );
}

describe("destructive button standard", () => {
  it("keeps destructive intent and icon shape on PillButton", () => {
    const pillButton = readFileSync(
      join(root, "components/ui/pill-button.tsx"),
      "utf8",
    );
    const button = readFileSync(join(root, "components/ui/button.tsx"), "utf8");

    expect(pillButton).toContain("iconOnly: true");
    expect(pillButton).toContain('data-icon-only={isIcon || undefined}');
    expect(pillButton).toContain("bg-destructive/10 text-destructive");
    expect(pillButton).not.toContain("red-500");
    expect(button).not.toContain("destructive:");
  });

  it("does not render destructive actions through another button primitive", () => {
    const violations = sourceFiles("app")
      .concat(sourceFiles("components"))
      .flatMap((path) => {
        const source = readFileSync(join(root, path), "utf8");
        return Array.from(
          source.matchAll(
            /<([A-Z][A-Za-z0-9.]*)\b[^>]*\bvariant="destructive"[^>]*>/g,
          ),
          (match) => ({ path, component: match[1] }),
        ).filter(({ component }) => component !== "PillButton");
      });

    expect(violations).toEqual([]);
  });
});
