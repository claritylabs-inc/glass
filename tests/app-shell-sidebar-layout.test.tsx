// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_SIDEBAR_COLLAPSED_WIDTH,
  APP_SIDEBAR_DEFAULT_WIDTH,
  APP_SIDEBAR_MAX_WIDTH,
  APP_SIDEBAR_MIN_WIDTH,
  AppShellSidebarLayout,
  appSidebarPreferenceStorageKey,
  clampAppSidebarWidth,
  isAppSidebarCollapsedSize,
  parseAppSidebarPreference,
} from "@/components/app-shell-sidebar-layout";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

async function renderLayout(collapsed = false) {
  const container = document.createElement("div");
  container.style.height = "800px";
  container.style.width = "1200px";
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(
      <AppShellSidebarLayout
        collapsed={collapsed}
        onCollapsedChange={vi.fn()}
        sidebar={<nav>Navigation</nav>}
      >
        <main>Content</main>
      </AppShellSidebarLayout>,
    );
    await Promise.resolve();
  });

  return container;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

describe("AppShellSidebarLayout", () => {
  it("keeps the navigation handle accessible and directly between the panels", async () => {
    const container = await renderLayout();
    const group = container.querySelector<HTMLElement>("[data-group]");
    const separator = container.querySelector<HTMLElement>(
      '[data-testid="app-shell-sidebar-separator"]',
    );

    expect(separator).not.toBeNull();
    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("aria-label")).toBe("Resize navigation");
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator?.tabIndex).toBe(0);
    expect(
      Array.from(group?.children ?? []).map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual([
      "app-shell-sidebar",
      "app-shell-sidebar-separator",
      "app-shell-sidebar-content",
    ]);
  });

  it("uses the existing mini width after crossing the expanded minimum", () => {
    expect(APP_SIDEBAR_COLLAPSED_WIDTH).toBe(56);
    expect(APP_SIDEBAR_DEFAULT_WIDTH).toBeGreaterThan(APP_SIDEBAR_MIN_WIDTH);
    expect(APP_SIDEBAR_MAX_WIDTH).toBeGreaterThan(APP_SIDEBAR_DEFAULT_WIDTH);
    expect(
      isAppSidebarCollapsedSize({
        inPixels: APP_SIDEBAR_MIN_WIDTH - 1,
        asPercentage: 15,
      }),
    ).toBe(true);
    expect(
      isAppSidebarCollapsedSize({
        inPixels: APP_SIDEBAR_MIN_WIDTH,
        asPercentage: 15,
      }),
    ).toBe(false);
  });

  it("scopes the browser preference to the signed-in user", () => {
    expect(appSidebarPreferenceStorageKey("operator-sidebar", "user-123")).toBe(
      "operator-sidebar:user-123",
    );
    expect(appSidebarPreferenceStorageKey("operator-sidebar")).toBeNull();
    expect(
      appSidebarPreferenceStorageKey("operator-sidebar", "   "),
    ).toBeNull();
  });

  it("restores a saved collapse state and expanded width", () => {
    expect(
      parseAppSidebarPreference(
        JSON.stringify({ collapsed: true, width: 312 }),
      ),
    ).toEqual({ collapsed: true, width: 312 });
    expect(parseAppSidebarPreference(null)).toEqual({
      collapsed: false,
      width: APP_SIDEBAR_DEFAULT_WIDTH,
    });
    expect(parseAppSidebarPreference("not-json")).toEqual({
      collapsed: false,
      width: APP_SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it("keeps restored widths inside the resize bounds", () => {
    expect(clampAppSidebarWidth(APP_SIDEBAR_MIN_WIDTH - 50)).toBe(
      APP_SIDEBAR_MIN_WIDTH,
    );
    expect(clampAppSidebarWidth(APP_SIDEBAR_MAX_WIDTH + 50)).toBe(
      APP_SIDEBAR_MAX_WIDTH,
    );
    expect(
      parseAppSidebarPreference(
        JSON.stringify({ collapsed: false, width: 10_000 }),
      ).width,
    ).toBe(APP_SIDEBAR_MAX_WIDTH);
  });
});
