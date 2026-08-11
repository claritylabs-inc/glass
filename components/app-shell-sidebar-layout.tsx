"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type {
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
  PanelSize,
} from "react-resizable-panels";

import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableSeparator,
} from "@/components/ui/resizable";

export const APP_SIDEBAR_COLLAPSED_WIDTH = 56;
export const APP_SIDEBAR_DEFAULT_WIDTH = 220;
export const APP_SIDEBAR_MIN_WIDTH = 180;
export const APP_SIDEBAR_MAX_WIDTH = 360;

export type AppSidebarPreference = {
  collapsed: boolean;
  width: number;
};

export function clampAppSidebarWidth(width: number) {
  return Math.min(
    APP_SIDEBAR_MAX_WIDTH,
    Math.max(APP_SIDEBAR_MIN_WIDTH, width),
  );
}

export function appSidebarPreferenceStorageKey(
  baseKey: string,
  userId?: string,
) {
  const normalizedUserId = userId?.trim();
  return normalizedUserId ? `${baseKey}:${normalizedUserId}` : null;
}

export function parseAppSidebarPreference(
  rawPreference: string | null,
): AppSidebarPreference {
  if (!rawPreference) {
    return { collapsed: false, width: APP_SIDEBAR_DEFAULT_WIDTH };
  }

  try {
    const parsed = JSON.parse(rawPreference) as {
      collapsed?: unknown;
      width?: unknown;
    };
    return {
      collapsed: parsed.collapsed === true,
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? clampAppSidebarWidth(parsed.width)
          : APP_SIDEBAR_DEFAULT_WIDTH,
    };
  } catch {
    return { collapsed: false, width: APP_SIDEBAR_DEFAULT_WIDTH };
  }
}

export function isAppSidebarCollapsedSize(size: PanelSize) {
  return size.inPixels < APP_SIDEBAR_MIN_WIDTH;
}

export function AppShellSidebarLayout({
  children,
  collapsed,
  defaultWidth = APP_SIDEBAR_DEFAULT_WIDTH,
  onCollapsedChange,
  onWidthChange,
  sidebar,
}: {
  children: ReactNode;
  collapsed: boolean;
  defaultWidth?: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onWidthChange?: (width: number) => void;
  sidebar: ReactNode;
}) {
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const expandedWidth = clampAppSidebarWidth(defaultWidth);

  useEffect(() => {
    const sidebarPanel = sidebarPanelRef.current;
    if (!sidebarPanel) return;

    if (collapsed) {
      if (!sidebarPanel.isCollapsed()) sidebarPanel.collapse();
      return;
    }

    if (sidebarPanel.isCollapsed()) sidebarPanel.expand();
    const currentWidth = sidebarPanel.getSize().inPixels;
    if (Math.abs(currentWidth - expandedWidth) > 0.5) {
      sidebarPanel.resize(expandedWidth);
    }
  }, [collapsed, expandedWidth]);

  const handleSidebarResize = useCallback(
    (
      size: PanelSize,
      _id: string | number | undefined,
      previous?: PanelSize,
    ) => {
      if (!previous) return;

      const nextCollapsed = isAppSidebarCollapsedSize(size);
      if (nextCollapsed !== collapsed) {
        onCollapsedChange(nextCollapsed);
      }
    },
    [collapsed, onCollapsedChange],
  );

  const handleSidebarLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;

      const size = sidebarPanelRef.current?.getSize();
      if (!size || isAppSidebarCollapsedSize(size)) return;

      onWidthChange?.(clampAppSidebarWidth(size.inPixels));
    },
    [onWidthChange],
  );

  return (
    <ResizablePanelGroup
      id="app-shell-sidebar-panels"
      orientation="horizontal"
      onLayoutChanged={handleSidebarLayoutChanged}
      className="min-h-0 flex-1 max-lg:[&>[data-panel]]:contents!"
    >
      <ResizablePanel
        id="app-shell-sidebar"
        panelRef={sidebarPanelRef}
        collapsible
        collapsedSize={APP_SIDEBAR_COLLAPSED_WIDTH}
        defaultSize={collapsed ? APP_SIDEBAR_COLLAPSED_WIDTH : expandedWidth}
        minSize={APP_SIDEBAR_MIN_WIDTH}
        maxSize={APP_SIDEBAR_MAX_WIDTH}
        groupResizeBehavior="preserve-pixel-size"
        onResize={handleSidebarResize}
        className="hidden h-full min-w-0 flex-col overflow-hidden lg:flex"
      >
        <aside className="flex h-full w-full min-w-0 flex-col border-r border-border bg-background">
          {sidebar}
        </aside>
      </ResizablePanel>

      <ResizableSeparator
        id="app-shell-sidebar-separator"
        aria-label="Resize navigation"
      />

      <ResizablePanel
        id="app-shell-sidebar-content"
        minSize={320}
        groupResizeBehavior="preserve-relative-size"
        className="contents lg:flex lg:h-full lg:min-w-0 lg:flex-1 lg:overflow-hidden"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
