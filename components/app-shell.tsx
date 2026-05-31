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
import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import { GlassPromptInput } from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useThreadCacheActions } from "@/lib/sync/glass-cached-queries";

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
import { getPublicAgentDomain } from "@/lib/domains";

const AGENT_DOMAIN = getPublicAgentDomain();

function inferAttachmentContentType(
  filename: string | undefined,
  mediaType: string | undefined,
) {
  if (mediaType) return mediaType;
  const lowerName = filename?.toLowerCase() ?? "";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".tsv")) return "text/tab-separated-values";
  if (lowerName.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lowerName.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowerName.endsWith(".xlsm"))
    return "application/vnd.ms-excel.sheet.macroEnabled.12";
  if (lowerName.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lowerName.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg"))
    return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown"))
    return "text/markdown";
  if (lowerName.endsWith(".json")) return "application/json";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

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
        onPointerDown={onPointerDown}
        className="absolute left-0 top-0 bottom-0 z-10 hidden w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 lg:block"
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
  const router = useRouter();
  const { context: pageContext } = usePageContext();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const {
    appendOptimisticSend,
    markOptimisticSendFailed,
    seedOptimisticThread,
  } = useThreadCacheActions();
  const [sending, setSending] = useState(false);
  const isThreadPage = pathname.startsWith("/agent/thread/");
  const hasContext = !!pageContext;
  const viewerOrg = useCachedQuery(
    "appShell.viewerOrg",
    api.orgs.viewerOrg,
    {},
  );
  const viewer = useCachedQuery("appShell.viewer", api.users.viewer, {});
  const agentBranding =
    viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
      ? {
          name: `${viewerOrg.brokerOrg.name} Agent`,
          iconUrl: viewerOrg.brokerOrg.iconUrl,
        }
      : undefined;

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
      if (sending) return;

      setSending(true);
      try {
        const messageClientMutationId = createClientMutationId("message");
        const threadId = await createThread({
          initialContext: pageContext ?? undefined,
          agentDomain: AGENT_DOMAIN,
          clientMutationId: createClientMutationId("thread"),
        });
        const content = text || "(attached files)";
        const optimisticAttachments =
          message.files.length > 0
            ? message.files.map((file) => ({
                filename: file.filename ?? "file",
                contentType: inferAttachmentContentType(
                  file.filename,
                  file.mediaType,
                ),
                size: 0,
              }))
            : undefined;

        if (viewerOrg?.org?._id && viewer?._id) {
          await seedOptimisticThread({
            threadId,
            orgId: viewerOrg.org._id,
            createdBy: viewer._id,
            initialContext: pageContext ?? undefined,
          });
          await appendOptimisticSend({
            threadId,
            orgId: viewerOrg.org._id,
            content,
            clientMutationId: messageClientMutationId,
            userId: viewer._id,
            userName: viewer.name ?? viewer.email ?? "You",
            attachments: optimisticAttachments,
            referencedPolicyIds: message.references
              ?.filter((reference) => reference.kind === "policy")
              .map((reference) => reference.id as Id<"policies">),
            referencedQuoteIds: message.references
              ?.filter((reference) => reference.kind === "quote")
              .map((reference) => reference.id as Id<"policies">),
            referencedRequirementIds: message.references
              ?.filter((reference) => reference.kind === "requirement")
              .map((reference) => reference.id as Id<"insuranceRequirements">),
            referencedMailboxIds: message.references
              ?.filter((reference) => reference.kind === "mailbox")
              .map((reference) => reference.id as Id<"connectedEmailAccounts">),
          });
        }

        router.push(`/agent/thread/${threadId}`);
        setSending(false);

        void (async () => {
          const attachments: {
            filename: string;
            contentType: string;
            size: number;
            fileId: Id<"_storage">;
          }[] = [];

          try {
            if (message.files.length > 0) {
              for (const file of message.files) {
                const uploadUrl = await generateUploadUrl();
                const blob = await fetch(file.url).then((r) => r.blob());
                const contentType = inferAttachmentContentType(
                  file.filename,
                  file.mediaType,
                );
                const res = await fetch(uploadUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": contentType,
                  },
                  body: blob,
                });

                if (res.ok) {
                  const { storageId } = await res.json();
                  attachments.push({
                    filename: file.filename ?? "file",
                    contentType,
                    size: blob.size,
                    fileId: storageId as Id<"_storage">,
                  });
                }
              }
            }

            await sendThreadMessage({
              threadId,
              content,
              attachments: attachments.length > 0 ? attachments : undefined,
              referencedPolicyIds: message.references
                ?.filter((reference) => reference.kind === "policy")
                .map((reference) => reference.id as Id<"policies">),
              referencedQuoteIds: message.references
                ?.filter((reference) => reference.kind === "quote")
                .map((reference) => reference.id as Id<"policies">),
              referencedRequirementIds: message.references
                ?.filter((reference) => reference.kind === "requirement")
                .map(
                  (reference) => reference.id as Id<"insuranceRequirements">,
                ),
              referencedMailboxIds: message.references
                ?.filter((reference) => reference.kind === "mailbox")
                .map(
                  (reference) => reference.id as Id<"connectedEmailAccounts">,
                ),
              clientMutationId: messageClientMutationId,
            });
          } catch (error) {
            if (viewerOrg?.org?._id) {
              await markOptimisticSendFailed({
                threadId,
                clientMutationId: messageClientMutationId,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to send message",
              });
            }
            toast.error("Failed to send message");
          }
        })();
      } catch {
        toast.error("Failed to start chat");
        setSending(false);
      }
    },
    [
      appendOptimisticSend,
      createThread,
      generateUploadUrl,
      markOptimisticSendFailed,
      pageContext,
      router,
      seedOptimisticThread,
      sendThreadMessage,
      sending,
      viewer,
      viewerOrg,
    ],
  );

  if (isThreadPage || !hasContext) return null;

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
            placeholder={
              agentBranding ? `Ask ${agentBranding.name}...` : "Ask Glass..."
            }
            contextLabel={pageContext?.summary}
            disabled={sending}
            status={sending ? "submitted" : "ready"}
            agentBranding={agentBranding}
            orgId={viewerOrg?.org?._id}
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
