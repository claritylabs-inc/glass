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
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import { GlassPromptInput } from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import { usePageContext } from "@/hooks/use-page-context";
import { EntityPreviewProvider, useEntityPreview } from "@/hooks/use-entity-preview";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import { CommandPalette } from "@/components/command-palette";
import dynamic from "next/dynamic";
import { getPublicAgentDomain } from "@/lib/domains";

const AGENT_DOMAIN = getPublicAgentDomain();

const PdfPanel = dynamic(
  () => import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
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
    const measuredWidth = slotRef.current?.getBoundingClientRect().width ?? widthRef.current;
    const startWidth = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, measuredWidth));
    const startX = event.clientX;
    widthRef.current = startWidth;
    setWidth(startWidth);
    setHasCustomWidth(true);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, startWidth + delta));
      if (nextWidth === widthRef.current) return;
      widthRef.current = nextWidth;
      setWidth(nextWidth);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
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
      className={`relative hidden h-full min-w-0 overflow-hidden lg:flex ${
        isFixedWidth ? "shrink-0" : "flex-1 basis-0"
      }`}
      style={isFixedWidth ? { width } : undefined}
    >
      <div
        onPointerDown={onPointerDown}
        className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12"
      />
      <div className="flex h-full min-w-0 w-full max-w-full flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function ShellContent({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview: entityPreview } = useEntityPreview();
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;
  const hasRightPanel = hasVisibleRightPanel(rightPanel);
  const visiblePanelCount = (hasRightPanel ? 1 : 0) + (hasEntityPanel ? 1 : 0) + (hasPdfPanel ? 1 : 0);
  const useEqualPanelLayout = visiblePanelCount >= 2;

  return (
    <div className="flex h-dvh w-full min-w-0 overflow-hidden">
      {/* AppSidebar uses useSearchParams; wrap in Suspense so the root
          layout can prerender pages like /_not-found without bailing. */}
      <Suspense fallback={null}>
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 overflow-hidden">
        {/* Main content column */}
        <div className={`flex flex-col min-w-0 overflow-hidden ${
          useEqualPanelLayout ? "flex-1 basis-0" : "flex-1"
        }`}>
          <AppTopBar
            actions={actions}
            breadcrumbDetail={breadcrumbDetail}
            presenceUsers={presenceUsers}
            onMobileMenuToggle={() => setMobileOpen((v) => !v)}
          />
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <main className="absolute inset-0 min-w-0 overflow-y-auto">
              <div className="w-full min-w-0 px-6 py-6 pb-32 lg:px-8">
                {children}
              </div>
            </main>
            <PersistentChatBar />
            <CommandPalette />
          </div>
        </div>
        {/* Right-side panels can stack: policy, email/drawer, then PDF. */}
        {hasEntityPanel && (
          useEqualPanelLayout ? (
            <ResizableRightPanelSlot equalLayout>
              <EntityPreviewPanel fitContainer />
            </ResizableRightPanelSlot>
          ) : (
            <div className="hidden h-full min-w-0 shrink-0 lg:flex">
              <EntityPreviewPanel />
            </div>
          )
        )}
        {hasRightPanel && rightPanel && (
          <ResizableRightPanelSlot equalLayout={useEqualPanelLayout}>
            {rightPanel}
          </ResizableRightPanelSlot>
        )}
        {hasPdfPanel && (
          useEqualPanelLayout ? (
            <ResizableRightPanelSlot equalLayout>
              <PdfPanel fitContainer />
            </ResizableRightPanelSlot>
          ) : (
            <div className="hidden h-full min-w-0 shrink-0 lg:flex">
              <PdfPanel />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function PersistentChatBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { context: pageContext } = usePageContext();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const [sending, setSending] = useState(false);
  const isThreadPage = pathname.startsWith("/agent/thread/");
  const hasContext = !!pageContext;
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const isBroker = (viewerOrg?.org as { type?: "broker" | "client" } | undefined)?.type === "broker";
  const agentBranding = viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
    ? { name: `${viewerOrg.brokerOrg.name} Agent`, iconUrl: viewerOrg.brokerOrg.iconUrl }
    : undefined;

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
      if (sending) return;

      setSending(true);
      try {
        const threadId = await createThread({
          initialContext: pageContext ?? undefined,
          agentDomain: AGENT_DOMAIN,
        });

        const attachments: {
          filename: string;
          contentType: string;
          size: number;
          fileId: Id<"_storage">;
        }[] = [];

        if (message.files.length > 0) {
          for (const file of message.files) {
            const uploadUrl = await generateUploadUrl();
            const blob = await fetch(file.url).then((r) => r.blob());
            const res = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": file.mediaType || "application/octet-stream",
              },
              body: blob,
            });

            if (res.ok) {
              const { storageId } = await res.json();
              attachments.push({
                filename: file.filename ?? "file",
                contentType: file.mediaType || "application/octet-stream",
                size: blob.size,
                fileId: storageId as Id<"_storage">,
              });
            }
          }
        }

        await sendThreadMessage({
          threadId,
          content: text || "(attached files)",
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        router.push(`/agent/thread/${threadId}`);
      } catch {
        toast.error("Failed to start chat");
      } finally {
        setSending(false);
      }
    },
    [
      createThread,
      generateUploadUrl,
      pageContext,
      router,
      sendThreadMessage,
      sending,
    ],
  );

  if (isThreadPage || !hasContext || isBroker) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="h-16 bg-linear-to-b from-white/0 via-white/40 to-white/80 dark:from-black/0 dark:via-black/40 dark:to-black/80" />
      <div
        className="pointer-events-auto bg-white/80 dark:bg-black/80 px-4 md:px-6 lg:px-8 pt-2"
        style={{
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="max-w-2xl mx-auto">
          <GlassPromptInput
            onSubmit={handleSubmit}
            placeholder={agentBranding ? `Ask ${agentBranding.name}...` : "Ask Glass..."}
            contextLabel={pageContext?.summary}
            disabled={sending}
            status={sending ? "submitted" : "ready"}
            agentBranding={agentBranding}
          />
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
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
          >
            {children}
          </ShellContent>
        </EntityPreviewProvider>
      </PdfProvider>
    </PageContextProvider>
  );
}
