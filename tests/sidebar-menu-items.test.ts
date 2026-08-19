import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformModifierForUserAgent } from "../components/app-sidebar/nav-item";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("sidebar menu items", () => {
  it("uses platform-aware command shortcut labels", () => {
    expect(platformModifierForUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("⌘");
    expect(platformModifierForUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Ctrl");
  });

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
    expect(navItem).toContain('shortcut.type === "command"');
    expect(navItem).toContain("platformModifierForUserAgent");
    expect(navItem).toContain('typeStyle("caption.default")');
    expect(navConfig).toContain("SIDEBAR_TOOLTIP_DELAY_MS = 500");
    expect(navConfig).toContain("data-instant:animate-none");
    expect(navConfig).toContain('"cursor-pointer rounded-md');
  });

  it("renders the main sidebar actions through the shared menu item", () => {
    const appSidebar = read("components/app-sidebar.tsx");
    const clientSidebar = read(
      "components/app-sidebar/client-detail-sidebar-content.tsx",
    );
    const mainSidebar = read("components/app-sidebar/main-sidebar-content.tsx");
    const navItem = read("components/app-sidebar/nav-item.tsx");

    for (const label of ["New Chat", "Notifications", "Sign out"]) {
      expect(mainSidebar).toContain(`label="${label}"`);
    }

    expect(mainSidebar).not.toContain('title={collapsed ? "New Chat"');
    expect(mainSidebar).not.toContain('title={collapsed ? "Notifications"');
    expect(mainSidebar).not.toContain('label="Ask Glass"');
    expect(mainSidebar).toContain('label="Archived"');
    expect(mainSidebar.indexOf('label="New Chat"')).toBeLessThan(
      mainSidebar.indexOf("pinnedConversations.map"),
    );
    expect(mainSidebar.indexOf("agentConversations.map")).toBeLessThan(
      mainSidebar.indexOf('label="Archived"'),
    );
    expect(mainSidebar).toContain("archivedThreadCount > 0");
    expect(mainSidebar).toContain('shortcut={commandShortcut("k")}');
    expect(mainSidebar).toContain('variant="icon"');
    expect(mainSidebar).toContain('href="/agent/threads"');
    expect(mainSidebar).toContain('label="All threads"');
    expect(mainSidebar).toContain('<Plus className="size-3.5" />');
    expect(mainSidebar).toContain("icon={List}");
    expect(mainSidebar).not.toContain('<span>All threads</span>');
    expect(clientSidebar).toContain("<SidebarHeaderLink");
    expect(clientSidebar).not.toContain('<span>All threads</span>');
    expect(navItem).toContain("export function SidebarHeaderLink");
    expect(navItem).toContain('aria-current={active ? "page" : undefined}');
    expect(mainSidebar).toContain("icon={Plus}");
    expect(appSidebar).toContain(
      "archivedThreadCount={archivedThreads?.length ?? 0}",
    );
  });

  it("keeps the sidebar rail mounted while route-specific menus transition", () => {
    const appSidebar = read("components/app-sidebar.tsx");
    const clientsLayout = read("app/clients/layout.tsx");
    const clientsPage = read("app/clients/page.tsx");
    const clientDetailLayout = read("app/clients/[clientOrgId]/layout.tsx");

    expect(appSidebar).toContain('key={activeMode}');
    expect(appSidebar).toContain('<AnimatePresence initial={false} mode="sync">');
    expect(appSidebar).toContain('className="absolute inset-0 overflow-hidden bg-background will-change-transform"');
    expect(appSidebar).toContain('useReducedMotion()');
    expect(clientsLayout).toContain("<ClientWorkspaceShell>{children}</ClientWorkspaceShell>");
    expect(clientsPage).not.toContain("<AppShell");
    expect(clientDetailLayout).not.toContain("<AppShell");
  });
});
