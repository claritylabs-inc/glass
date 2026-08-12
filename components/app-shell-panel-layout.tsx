"use client";

import { useMemo, type ReactNode } from "react";

import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableSeparator,
  useDefaultLayout,
} from "@/components/ui/resizable";

type AuxiliaryPanel = {
  content: ReactNode;
  defaultWidth: number;
  desktopOnly?: boolean;
  id: "entity" | "right" | "pdf";
  label: string;
  maxWidth: number;
  minWidth: number;
};

const EQUAL_LAYOUT_CONSTRAINTS = {
  auxiliaryMaxSize: "60%",
  auxiliaryMinSize: "10%",
  mainMinSize: "20%",
} as const;

const panelLayoutStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
};

export function AppShellPanelLayout({
  entityPanel,
  main,
  pdfPanel,
  rightPanel,
  storageUserId,
}: {
  entityPanel?: ReactNode;
  main: ReactNode;
  pdfPanel?: ReactNode;
  rightPanel?: ReactNode;
  storageUserId?: string;
}) {
  const hasEntityPanel = Boolean(entityPanel);
  const hasPdfPanel = Boolean(pdfPanel);
  const hasRightPanel = Boolean(rightPanel);
  const auxiliaryPanels: AuxiliaryPanel[] = [];

  if (hasEntityPanel) {
    auxiliaryPanels.push({
      content: entityPanel,
      defaultWidth: 400,
      desktopOnly: true,
      id: "entity",
      label: "Resize policy preview",
      maxWidth: 700,
      minWidth: 320,
    });
  }

  if (hasRightPanel) {
    auxiliaryPanels.push({
      content: rightPanel,
      defaultWidth: 420,
      id: "right",
      label: "Resize detail panel",
      maxWidth: 760,
      minWidth: 320,
    });
  }

  if (hasPdfPanel) {
    auxiliaryPanels.push({
      content: pdfPanel,
      defaultWidth: 540,
      desktopOnly: true,
      id: "pdf",
      label: "Resize PDF preview",
      maxWidth: 900,
      minWidth: 360,
    });
  }

  const useEqualLayout = auxiliaryPanels.length >= 2;
  const equalSize = `${100 / (auxiliaryPanels.length + 1)}%`;
  const panelIds = useMemo(
    () => [
      "app-shell-main",
      ...(hasEntityPanel ? ["app-shell-entity"] : []),
      ...(hasRightPanel ? ["app-shell-right"] : []),
      ...(hasPdfPanel ? ["app-shell-pdf"] : []),
    ],
    [hasEntityPanel, hasPdfPanel, hasRightPanel],
  );
  const layoutStorageId = `glass:app-shell-panels:${storageUserId ?? "pending"}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutStorageId,
    panelIds,
    storage: panelLayoutStorage,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <ResizablePanelGroup
      id="app-shell-panels"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      orientation="horizontal"
      className="min-w-0 flex-1 max-lg:[&>[data-panel]]:contents!"
    >
      <ResizablePanel
        id="app-shell-main"
        defaultSize={useEqualLayout ? equalSize : undefined}
        minSize={
          useEqualLayout
            ? EQUAL_LAYOUT_CONSTRAINTS.mainMinSize
            : undefined
        }
        groupResizeBehavior="preserve-relative-size"
        className="flex h-full min-w-0 flex-col overflow-hidden max-lg:flex-1"
      >
        {main}
      </ResizablePanel>

      {auxiliaryPanels.flatMap((panel) => [
        <ResizableSeparator
          key={`separator-${panel.id}`}
          id={`app-shell-separator-${panel.id}`}
          aria-label={panel.label}
        />,
        <ResizablePanel
          key={panel.id}
          id={`app-shell-${panel.id}`}
          defaultSize={useEqualLayout ? equalSize : panel.defaultWidth}
          minSize={
            useEqualLayout
              ? EQUAL_LAYOUT_CONSTRAINTS.auxiliaryMinSize
              : panel.minWidth
          }
          maxSize={
            useEqualLayout
              ? EQUAL_LAYOUT_CONSTRAINTS.auxiliaryMaxSize
              : panel.maxWidth
          }
          groupResizeBehavior={
            useEqualLayout ? "preserve-relative-size" : "preserve-pixel-size"
          }
          className="contents lg:flex lg:h-full lg:min-w-0 lg:w-full lg:max-w-full lg:flex-1 lg:overflow-hidden"
        >
          {panel.desktopOnly ? (
            <div className="hidden h-full w-full min-w-0 overflow-hidden lg:flex">
              {panel.content}
            </div>
          ) : (
            panel.content
          )}
        </ResizablePanel>,
      ])}
    </ResizablePanelGroup>
  );
}
