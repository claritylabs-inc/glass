"use client";

import {
  Children,
  Fragment,
  Suspense,
  isValidElement,
  useState,
  useCallback,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellPanelLayout } from "@/components/app-shell-panel-layout";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import { OperatorImpersonationBanner } from "@/components/operator-impersonation-banner";

import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import {
  EntityPreviewProvider,
  useEntityPreview,
} from "@/hooks/use-entity-preview";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import {
  CommandPalette,
  openCommandPalette,
} from "@/components/command-palette";
import dynamic from "next/dynamic";

const PdfPanel = dynamic(
  () =>
    import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

function hasVisibleRightPanel(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") {
    return false;
  }

  if (Array.isArray(node)) {
    return node.some(hasVisibleRightPanel);
  }

  if (!isValidElement(node)) {
    return true;
  }

  if (node.type === Fragment) {
    return Children.toArray(
      (node.props as { children?: React.ReactNode }).children,
    ).some(hasVisibleRightPanel);
  }

  const props = node.props as { open?: unknown };
  if (props.open === false) {
    return false;
  }

  return true;
}

function ShellContent({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
  customSidebar,
  customSidebarStorageKey = "custom-sidebar-collapsed",
  disableCommandPalette = false,
  showBrokerShare = true,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
  customSidebar?: (props: {
    collapsed: boolean;
    onToggleCollapse: () => void;
  }) => React.ReactNode;
  customSidebarStorageKey?: string;
  disableCommandPalette?: boolean;
  showBrokerShare?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customSidebarCollapsed, setCustomSidebarCollapsed] = useState(() => {
    if (!customSidebar) return false;
    try {
      return localStorage.getItem(customSidebarStorageKey) === "1";
    } catch {
      return false;
    }
  });
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview: entityPreview } = useEntityPreview();
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;
  const hasRightPanel = hasVisibleRightPanel(rightPanel);
  const toggleCustomSidebarCollapse = useCallback(() => {
    setCustomSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(customSidebarStorageKey, next ? "1" : "");
      } catch {}
      return next;
    });
  }, [customSidebarStorageKey]);
  const renderedCustomSidebar = customSidebar?.({
    collapsed: customSidebarCollapsed,
    onToggleCollapse: toggleCustomSidebarCollapse,
  });
  const renderedMobileCustomSidebar = customSidebar?.({
    collapsed: false,
    onToggleCollapse: toggleCustomSidebarCollapse,
  });

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {customSidebar ? (
          <>
            <aside
              className={`hidden h-full shrink-0 flex-col border-r border-foreground/6 bg-background sidebar-transition lg:flex ${
                customSidebarCollapsed ? "w-14" : "w-[220px]"
              }`}
            >
              {renderedCustomSidebar}
            </aside>
            <AnimatePresence>
              {mobileOpen ? (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-40 bg-black/20 lg:hidden"
                    onClick={() => setMobileOpen(false)}
                  />
                  <motion.aside
                    initial={{ x: -280 }}
                    animate={{ x: 0 }}
                    exit={{ x: -280 }}
                    transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                    className="fixed bottom-0 left-0 top-0 z-50 w-[260px] border-r border-foreground/6 bg-background lg:hidden"
                  >
                    {renderedMobileCustomSidebar}
                  </motion.aside>
                </>
              ) : null}
            </AnimatePresence>
          </>
        ) : (
          <Suspense fallback={null}>
            <AppSidebar
              mobileOpen={mobileOpen}
              onMobileClose={() => setMobileOpen(false)}
              onAskGlass={
                disableCommandPalette ? undefined : openCommandPalette
              }
            />
          </Suspense>
        )}
        <AppShellPanelLayout
          main={
            <>
              <AppTopBar
                actions={actions}
                breadcrumbDetail={breadcrumbDetail}
                presenceUsers={presenceUsers}
                showBrokerShare={showBrokerShare}
                onMobileMenuToggle={() => setMobileOpen((v) => !v)}
              />
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <main className="absolute inset-0 min-w-0 overflow-y-auto scrollbar-hide">
                  <div className="w-full min-w-0 px-6 py-6 pb-32 lg:px-8">
                    {children}
                  </div>
                </main>
                {disableCommandPalette ? null : <CommandPalette />}
              </div>
            </>
          }
          entityPanel={hasEntityPanel ? <EntityPreviewPanel /> : undefined}
          rightPanel={hasRightPanel ? rightPanel : undefined}
          pdfPanel={hasPdfPanel ? <PdfPanel /> : undefined}
        />
      </div>
      <OperatorImpersonationBanner />
    </div>
  );
}

export function AppShell({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
  customSidebar,
  customSidebarStorageKey,
  disableCommandPalette,
  showBrokerShare,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
  customSidebar?: (props: {
    collapsed: boolean;
    onToggleCollapse: () => void;
  }) => React.ReactNode;
  customSidebarStorageKey?: string;
  disablePersistentChat?: boolean;
  disableCommandPalette?: boolean;
  showBrokerShare?: boolean;
}) {
  return (
    <PageContextProvider>
      <PdfProvider>
        <EntityPreviewProvider>
          <ShellContent
            actions={actions}
            breadcrumbDetail={breadcrumbDetail}
            presenceUsers={presenceUsers}
            rightPanel={rightPanel}
            customSidebar={customSidebar}
            customSidebarStorageKey={customSidebarStorageKey}
            disableCommandPalette={disableCommandPalette}
            showBrokerShare={showBrokerShare}
          >
            {children}
          </ShellContent>
        </EntityPreviewProvider>
      </PdfProvider>
    </PageContextProvider>
  );
}
