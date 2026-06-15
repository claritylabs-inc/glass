import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("toaster layout", () => {
  it("keeps Sonner toasts bounded and consistently stacked", () => {
    const toaster = read("components/ui/toaster.tsx");
    const globals = read("app/globals.css");

    expect(toaster).toContain("expand");
    expect(toaster).toContain('visibleToasts={4}');
    expect(toaster).toContain("mobileOffset={{");
    expect(toaster).toContain(
      'bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)"',
    );
    expect(toaster).toContain('"--width": "min(356px, calc(100vw - 2rem))"');
    expect(toaster).toContain('width: "var(--width)"');
    expect(toaster).toContain('maxWidth: "calc(100vw - 2rem)"');
    expect(toaster).toContain("!overflow-hidden");
    expect(globals).toContain('[data-sonner-toaster][data-x-position="right"]');
    expect(globals).toContain("right: var(--mobile-offset-right)");
    expect(globals).toContain("[data-sonner-toast][data-x-position=\"right\"]");
  });
});
