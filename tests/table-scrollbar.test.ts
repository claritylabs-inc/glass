import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("table scrollbar", () => {
  it("uses the shared quiet theme-aware scrollbar for table overflow", () => {
    const table = read("components/ui/table.tsx");
    const markdown = read("components/prose-markdown.tsx");
    const routing = read("app/operator/routing/routing-tab.tsx");
    const globals = read("app/globals.css");

    expect(table).toContain('className="table-scrollbar relative w-full overflow-x-auto"');
    expect(table).toContain("w-max min-w-full caption-bottom");
    expect(table).toContain("px-4 py-3 align-middle whitespace-nowrap");
    expect(markdown).toContain("table-scrollbar my-3 overflow-x-auto");
    expect(routing.match(/table-scrollbar overflow-x-auto/g)).toHaveLength(2);
    expect(globals).toContain(".table-scrollbar::-webkit-scrollbar-thumb");
    expect(globals).toContain("scrollbar-width: thin");
    expect(globals).toContain("background-clip: padding-box");
    expect(globals).toContain("var(--foreground)");
  });
});
