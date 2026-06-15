"use client";

import {
  Children,
  Fragment,
  Suspense,
  isValidElement,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import {
  ChatInputOverlay,
  GlassPromptInput,
} from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import { usePageContext } from "@/hooks/use-page-context";
import {
  EntityPreviewProvider,
  useEntityPreview,
} from "@/hooks/use-entity-preview";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import { CommandPalette } from "@/components/command-palette";
import dynamic from "next/dynamic";
import { useStartAgentThread } from "@/hooks/use-start-agent-thread";

const PdfPanel = dynamic(
  () =>
    import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

const MIN_RIGHT_PANEL_WIDTH = 320;
const MAX_RIGHT_PANEL_WIDTH = 760;
const DEFAULT_RIGHT_PANEL_WIDTH = 420;

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

function ResizableRightPanelSlot({
  children,
  equalLayout,
}: {
  children: React.ReactNode;
  equalLayout: boolean;
}) {
  const [width, setWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH);
  const [hasCustomWidth, setHasCustomWidth] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(DEFAULT_RIGHT_PANEL_WIDTH);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const resizeHandle = event.currentTarget;
    resizeHandle.setPointerCapture?.(event.pointerId);
    const measuredWidth =
      slotRef.current?.getBoundingClientRect().width ?? widthRef.current;
    const startWidth = Math.min(
      MAX_RIGHT_PANEL_WIDTH,
      Math.max(MIN_RIGHT_PANEL_WIDTH, measuredWidth),
    );
    const startX = event.clientX;
    widthRef.current = startWidth;
    setWidth(startWidth);
    setHasCustomWidth(true);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(
        MAX_RIGHT_PANEL_WIDTH,
        Math.max(MIN_RIGHT_PANEL_WIDTH, startWidth + delta),
      );
      if (nextWidth === widthRef.current) return;
      widthRef.current = nextWidth;
      setWidth(nextWidth);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      resizeHandle.releasePointerCapture?.(event.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const isFixedWidth = hasCustomWidth || !equalLayout;

  return (
    <div
      ref={slotRef}
      className={`contents lg:relative lg:flex lg:h-full lg:min-w-0 lg:overflow-hidden ${
        isFixedWidth ? "shrink-0" : "flex-1 basis-0"
      }`}
      style={isFixedWidth ? { width } : undefined}
    >
      <div
        aria-label="Resize panel"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        role="separator"
        className="absolute left-0 top-0 bottom-0 z-20 hidden w-3 -translate-x-1.5 cursor-col-resize touch-none lg:block after:absolute after:left-1/2 after:top-0 after:bottom-0 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-foreground/10 active:after:bg-foreground/16"
      />
      <div className="contents lg:flex lg:h-full lg:min-w-0 lg:w-full lg:max-w-full lg:flex-1 lg:overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function ShellContent({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
  customSidebar,
  customSidebarStorageKey = "custom-sidebar-collapsed",
  disablePersistentChat = false,
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
  disablePersistentChat?: boolean;
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
  const visiblePanelCount =
    (hasRightPanel ? 1 : 0) + (hasEntityPanel ? 1 : 0) + (hasPdfPanel ? 1 : 0);
  const useEqualPanelLayout = visiblePanelCount >= 2;
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
    <div className="flex h-dvh w-full min-w-0 overflow-hidden">
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
          />
        </Suspense>
      )}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        {/* Main content column */}
        <div
          className={`flex flex-col min-w-0 overflow-hidden ${
            useEqualPanelLayout ? "flex-1 basis-0" : "flex-1"
          }`}
        >
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
            {disablePersistentChat ? null : <PersistentChatBar />}
            {disableCommandPalette ? null : <CommandPalette />}
          </div>
        </div>
        {/* Right-side panels can stack: policy, email/drawer, then PDF. */}
        {hasEntityPanel &&
          (useEqualPanelLayout ? (
            <ResizableRightPanelSlot equalLayout>
              <EntityPreviewPanel fitContainer />
            </ResizableRightPanelSlot>
          ) : (
            <div className="hidden h-full min-w-0 shrink-0 lg:flex">
              <EntityPreviewPanel />
            </div>
          ))}
        {hasRightPanel && rightPanel && (
          <ResizableRightPanelSlot equalLayout={useEqualPanelLayout}>
            {rightPanel}
          </ResizableRightPanelSlot>
        )}
        {hasPdfPanel &&
          (useEqualPanelLayout ? (
            <ResizableRightPanelSlot equalLayout>
              <PdfPanel fitContainer />
            </ResizableRightPanelSlot>
          ) : (
            <div className="hidden h-full min-w-0 shrink-0 lg:flex">
              <PdfPanel />
            </div>
          ))}
      </div>
    </div>
  );
}

function PersistentChatBar() {
  const pathname = usePathname();
  const { context: pageContext } = usePageContext();
  const [sending, setSending] = useState(false);
  const isThreadPage = pathname.startsWith("/agent/thread/");
  const hasContext = !!pageContext;
  const { agentBranding, startAgentThread, viewerOrg } =
    useStartAgentThread("appShell");

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (sending) return;

      setSending(true);
      try {
        await startAgentThread(message, pageContext ?? undefined);
      } finally {
        setSending(false);
      }
    },
    [pageContext, sending, startAgentThread],
  );

  if (isThreadPage || !hasContext) return null;

  return (
    <ChatInputOverlay>
      <GlassPromptInput
        onSubmit={handleSubmit}
        placeholder={
          agentBranding ? `Ask ${agentBranding.name}...` : "Ask Glass..."
        }
        contextLabel={pageContext?.summary}
        disabled={sending}
        status={sending ? "submitted" : "ready"}
        agentBranding={agentBranding}
        orgId={viewerOrg?.org?._id}
      />
    </ChatInputOverlay>
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
  disablePersistentChat,
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
            disablePersistentChat={disablePersistentChat}
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
