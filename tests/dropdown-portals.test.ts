import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("shared dropdown portals", () => {
  it("renders every shared popup owner through a portal", () => {
    const select = read("components/ui/select.tsx");
    const dropdownMenu = read("components/ui/dropdown-menu.tsx");
    const popover = read("components/ui/popover.tsx");
    const searchableSelect = read("components/ui/searchable-select.tsx");

    expect(select).toContain("<SelectPrimitive.Portal>");
    expect(dropdownMenu).toContain("<MenuPrimitive.Portal>");
    expect(popover).toContain("<PopoverPrimitive.Portal>");
    expect(searchableSelect).toContain("<PopoverContent");
    expect(searchableSelect).not.toContain('className="absolute z-50 top-full');
  });
});
