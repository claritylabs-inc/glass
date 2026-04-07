"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import { AskPrismInput } from "@/components/ask-prism-input";
import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import { EntityPreviewProvider, useEntityPreview } from "@/hooks/use-entity-preview";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import { CommandPalette } from "@/components/command-palette";
import dynamic from "next/dynamic";

const PdfPanel = dynamic(
  () => import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

function ShellContent({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview: entityPreview } = useEntityPreview();
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;

  return (
    <div className="h-dvh flex overflow-hidden">
      <AppSidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
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
            <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6 pb-24">
              {children}
            </div>
          </main>
          <AskPrismInput />
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
    </div>
  );
}

export function AppShell({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
}) {
  return (
    <PageContextProvider>
      <PdfProvider>
        <EntityPreviewProvider>
          <ShellContent actions={actions} breadcrumbDetail={breadcrumbDetail} presenceUsers={presenceUsers}>
            {children}
          </ShellContent>
        </EntityPreviewProvider>
      </PdfProvider>
    </PageContextProvider>
  );
}
