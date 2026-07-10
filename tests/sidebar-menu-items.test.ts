import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("sidebar menu items", () => {
  it("uses one shared tooltip contract for route and action rows", () => {
    const appSidebar = read("components/app-sidebar.tsx");
    const navItem = read("components/app-sidebar/nav-item.tsx");
    const navConfig = read("components/app-sidebar/nav-config.tsx");

    expect(appSidebar).toContain(
      "<SidebarTooltipProvider>{content}</SidebarTooltipProvider>",
    );
    expect(navItem).toContain("export function SidebarMenuItem");
    expect(navItem).toContain("<TooltipTrigger render={item} />");
    expect(navItem).toContain("<ShortcutTooltipContent");
    expect(navItem).toContain('<span className="text-label">{label}</span>');
    expect(navConfig).toContain("SIDEBAR_TOOLTIP_DELAY_MS = 500");
    expect(navConfig).toContain("data-instant:animate-none");
    expect(navConfig).toContain('"cursor-pointer rounded-md');
  });

  it("renders the main sidebar actions through the shared menu item", () => {
    const mainSidebar = read("components/app-sidebar/main-sidebar-content.tsx");

    for (const label of ["Ask Glass", "Notifications", "Sign out"]) {
      expect(mainSidebar).toContain(`label="${label}"`);
    }

    expect(mainSidebar).not.toContain('title={collapsed ? "Ask Glass"');
    expect(mainSidebar).not.toContain('title={collapsed ? "Notifications"');
  });
});
