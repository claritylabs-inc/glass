"use client";

import { Suspense, useState, useCallback } from "react";
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

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

const PdfPanel = dynamic(
  () => import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

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

  return (
    <div className="h-dvh flex overflow-hidden">
      {/* AppSidebar uses useSearchParams; wrap in Suspense so the root
          layout can prerender pages like /_not-found without bailing. */}
      <Suspense fallback={null}>
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
      </Suspense>
      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppTopBar
          actions={actions}
          breadcrumbDetail={breadcrumbDetail}
          presenceUsers={presenceUsers}
          onMobileMenuToggle={() => setMobileOpen((v) => !v)}
        />
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <main className="absolute inset-0 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6 pb-32">
              {children}
            </div>
          </main>
          <PersistentChatBar />
          <CommandPalette />
        </div>
      </div>
      {/* Right-side panels — PDF or entity preview */}
      {hasPdfPanel && (
        <div className="hidden lg:flex shrink-0 h-full">
          <PdfPanel />
        </div>
      )}
      {!hasPdfPanel && hasEntityPanel && (
        <div className="hidden lg:flex shrink-0 h-full">
          <EntityPreviewPanel />
        </div>
      )}
      {rightPanel && (
        <div className="contents lg:flex lg:shrink-0 lg:h-full">{rightPanel}</div>
      )}
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
                size: 0,
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
      <div className="h-16 bg-gradient-to-b from-white/0 via-white/40 to-white/80 dark:from-black/0 dark:via-black/40 dark:to-black/80" />
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
