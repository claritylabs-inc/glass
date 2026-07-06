import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("toaster layout", () => {
  it("keeps Sonner toasts bounded and consistently stacked", () => {
    const toaster = read("components/ui/toaster.tsx");
    const banner = read("components/operator-impersonation-banner.tsx");
    const globals = read("app/globals.css");

    expect(toaster).not.toContain("\n      expand");
    expect(toaster).toContain('visibleToasts={4}');
    expect(toaster).toContain('bottom: "calc(var(--glass-app-bottom-inset, 0px) + 1.5rem)"');
    expect(toaster).toContain("mobileOffset={{");
    expect(toaster).toContain(
      '"calc(var(--glass-app-bottom-inset, 0px) + env(safe-area-inset-bottom) + 5.5rem)"',
    );
    expect(toaster).toContain('"--width": "min(356px, calc(100vw - 2rem))"');
    expect(toaster).toContain('width: "var(--width)"');
    expect(toaster).toContain('maxWidth: "calc(100vw - 2rem)"');
    expect(toaster).toContain("!overflow-hidden");
    expect(globals).toContain('[data-sonner-toaster][data-x-position="right"]');
    expect(globals).toContain("right: var(--mobile-offset-right)");
    expect(globals).toContain("[data-sonner-toast][data-x-position=\"right\"]");
    expect(banner).toContain("--glass-app-bottom-inset");
  });

  it("uses the custom PillButton layout for duplicate upload confirmation", () => {
    const duplicateUpload = read("lib/policy-upload-duplicates.tsx");

    expect(duplicateUpload).toContain("toast.custom");
    expect(duplicateUpload).toContain("<PillButton");
    expect(duplicateUpload).toContain("Continue upload");
    expect(duplicateUpload).not.toContain("toast.warning");
    expect(duplicateUpload).not.toContain("action: {");
    expect(duplicateUpload).not.toContain("cancel: {");
  });
});
