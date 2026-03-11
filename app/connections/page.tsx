"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { ConnectionForm } from "@/components/connection-form";
import { ScanModal } from "@/components/scan-modal";
import { ScanStatus } from "@/components/scan-status";
import { ExtractionTable } from "@/components/extraction-table";
import { ExtractionLog } from "@/components/extraction-log";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { Mail, Trash2, Play, Square } from "lucide-react";
import { ConnectionIcon } from "@/components/connection-icon";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import { Id } from "@/convex/_generated/dataModel";

const TABS = [
  { id: "connections", label: "Connections" },
  { id: "processing", label: "Processing" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function RemoveConnectionDialog({
  connectionId,
  connectionLabel,
  open,
  onClose,
}: {
  connectionId: Id<"emailConnections">;
  connectionLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const removeConnection = useMutation(api.connections.remove);
  const counts = useQuery(
    api.connections.countLinkedPolicies,
    open ? { id: connectionId } : "skip"
  );
  const [removing, setRemoving] = useState(false);

  const handleRemove = async (deletePolicies: boolean) => {
    setRemoving(true);
    try {
      await removeConnection({ id: connectionId, deletePolicies });
      onClose();
      toast.success("Connection removed");
    } catch {
      toast.error("Failed to remove connection");
    } finally {
      setRemoving(false);
    }
  };

  const hasPolicies = counts && counts.policyCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove Connection</DialogTitle>
          <DialogDescription>
            Remove <strong>{connectionLabel}</strong> and its{" "}
            {counts ? counts.emailCount : "..."} emails?
            {hasPolicies && (
              <>
                <br />
                <br />
                This connection has{" "}
                <strong>{counts.policyCount} extracted {counts.policyCount === 1 ? "policy" : "policies"}</strong>.
                Would you like to remove those as well?
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <PillButton variant="secondary" onClick={onClose} disabled={removing}>
            Cancel
          </PillButton>
          {hasPolicies ? (
            <>
              <PillButton variant="secondary" onClick={() => handleRemove(false)} disabled={removing}>
                Keep policies
              </PillButton>
              <PillButton variant="destructive" onClick={() => handleRemove(true)} disabled={removing}>
                {removing ? "Removing..." : "Remove all"}
              </PillButton>
            </>
          ) : (
            <PillButton variant="destructive" onClick={() => handleRemove(false)} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
            </PillButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as TabId) || "connections";
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some((t) => t.id === initialTab) ? initialTab : "connections"
  );

  const connections = useQuery(api.connections.list);
  const pending = useQuery(
    api.policies.listPending,
    activeTab === "processing" ? {} : "skip"
  );
  const log = useQuery(
    api.policies.listExtractionLog,
    activeTab === "history" ? {} : "skip"
  );

  const [formOpen, setFormOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<{
    id: Id<"emailConnections">;
    defaults?: {
      sinceDate?: string;
      untilDate?: string;
      senderDomains?: string[];
      lastScanAt?: number;
    };
  } | null>(null);
  const stopScan = useMutation(api.connections.stopScan);
  const [removeTarget, setRemoveTarget] = useState<{
    id: Id<"emailConnections">;
    label: string;
  } | null>(null);

  const openScanModal = (conn: NonNullable<typeof connections>[number]) => {
    setScanTarget({
      id: conn._id,
      defaults: {
        sinceDate: conn.lastScanParams?.sinceDate,
        untilDate: conn.lastScanParams?.untilDate,
        senderDomains: conn.lastScanParams?.senderDomains,
        lastScanAt: conn.lastScanAt,
      },
    });
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    const url = tab === "connections" ? "/connections" : `/connections?tab=${tab}`;
    router.replace(url, { scroll: false });
  };

  const pendingCount = pending?.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-12 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="!mb-1">Email Connections</h1>
                <p className="text-body-sm text-muted-foreground">
                  Manage connections, track processing, and review extraction history
                </p>
              </div>
              {activeTab === "connections" && (
                <div className="hidden md:block">
                  <PillButton onClick={() => setFormOpen(true)}>
                    Add Connection <ArrowRight className="w-3 h-3" />
                  </PillButton>
                </div>
              )}
            </div>
          </FadeIn>

          {/* Tabs */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="flex items-center gap-1 border-b border-foreground/6 mb-6 overflow-x-auto scrollbar-hide">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/70"
                  }`}
                >
                  {tab.label}
                  {tab.id === "processing" && pendingCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700">
                      {pendingCount}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="connections-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              ))}
            </div>
          </FadeIn>

          {/* Connections tab */}
          {activeTab === "connections" && (
            <>
              {connections === undefined && (
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-8 h-8 rounded-md shrink-0" />
                        <div className="flex-1 min-w-0">
                          <Skeleton className="h-4 w-36 mb-1.5" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <div className="hidden md:flex items-center gap-3">
                          <Skeleton className="h-5 w-16 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-8 w-16 rounded-full" />
                          <Skeleton className="h-8 w-8 rounded-md" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {connections && connections.length === 0 && (
                <FadeIn when={true} delay={0.2} duration={0.6}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-8 text-center">
                    <p className="text-body-sm text-muted-foreground/60">
                      No email connections yet
                    </p>
                  </div>
                </FadeIn>
              )}

              <div className="space-y-3">
                {connections?.map((conn, i) => {
                  const isScanning = conn.scanProgress && conn.scanProgress.phase !== "complete";
                  const isDemo = conn.isDemo === true;

                  return (
                    <FadeIn
                      key={conn._id}
                      when={true}
                      staggerIndex={i + 2}
                      duration={0.6}
                    >
                      <div className={`rounded-lg border bg-white/60 px-4 py-3 ${isDemo ? "border-amber-200/60" : "border-foreground/6"}`}>
                        {/* Desktop layout: single row */}
                        <div className="hidden md:flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <ConnectionIcon imapHost={conn.imapHost} className="w-8 h-8 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-medium text-foreground truncate">
                                  {conn.label}
                                </p>
                                {isDemo && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700 shrink-0">
                                    Demo
                                  </span>
                                )}
                              </div>
                              <p className="text-label-sm text-muted-foreground/60 truncate">
                                {conn.email} · {conn.imapHost}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {!isDemo && (
                              <ScanStatus
                                status={conn.lastScanStatus}
                                error={conn.lastScanError}
                                progress={conn.scanProgress}
                              />
                            )}
                            {conn.emailsFound != null && !isScanning && (
                              <span className="text-label-sm text-muted-foreground">
                                {conn.emailsFound} emails ·{" "}
                                {conn.policiesExtracted ?? 0} policies
                              </span>
                            )}
                            {!isDemo && (
                              isScanning ? (
                                <PillButton
                                  variant="destructive"
                                  onClick={() => stopScan({ id: conn._id })}
                                >
                                  <Square className="w-3 h-3" />
                                  Stop
                                </PillButton>
                              ) : (
                                <PillButton
                                  variant="secondary"
                                  onClick={() => openScanModal(conn)}
                                >
                                  <Play className="w-3 h-3" />
                                  Scan
                                </PillButton>
                              )
                            )}
                            <PillButton
                              variant="icon"
                              label="Remove"
                              onClick={() =>
                                setRemoveTarget({ id: conn._id, label: conn.label })
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </PillButton>
                          </div>
                        </div>

                        {/* Mobile layout: vertical stack */}
                        <div className="md:hidden space-y-3">
                          <div className="flex items-center gap-3">
                            <ConnectionIcon imapHost={conn.imapHost} className="w-8 h-8 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-medium text-foreground truncate">
                                  {conn.label}
                                </p>
                                {isDemo && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700 shrink-0">
                                    Demo
                                  </span>
                                )}
                              </div>
                              <p className="text-label-sm text-muted-foreground/60 truncate">
                                {conn.email} · {conn.imapHost}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isDemo && (
                              <ScanStatus
                                status={conn.lastScanStatus}
                                error={conn.lastScanError}
                                progress={conn.scanProgress}
                              />
                            )}
                            {conn.emailsFound != null && !isScanning && (
                              <span className="text-label-sm text-muted-foreground">
                                {conn.emailsFound} emails · {conn.policiesExtracted ?? 0} policies
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {!isDemo && (
                              isScanning ? (
                                <PillButton
                                  variant="destructive"
                                  onClick={() => stopScan({ id: conn._id })}
                                >
                                  <Square className="w-3 h-3" />
                                  Stop
                                </PillButton>
                              ) : (
                                <PillButton
                                  variant="secondary"
                                  onClick={() => openScanModal(conn)}
                                >
                                  <Play className="w-3 h-3" />
                                  Scan
                                </PillButton>
                              )
                            )}
                            <PillButton
                              variant="icon"
                              label="Remove"
                              onClick={() => setRemoveTarget({ id: conn._id, label: conn.label })}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </PillButton>
                          </div>
                        </div>
                      </div>
                    </FadeIn>
                  );
                })}
              </div>
            </>
          )}

          {/* Processing tab */}
          {activeTab === "processing" && (
            <ExtractionTable extractions={pending} />
          )}

          {/* History tab */}
          {activeTab === "history" && (
            <ExtractionLog entries={log ?? []} />
          )}
        </div>
      </main>

      {activeTab === "connections" && (
        <FixedMobileFooter>
          <PillButton onClick={() => setFormOpen(true)}>
            Add Connection <ArrowRight className="w-3 h-3" />
          </PillButton>
        </FixedMobileFooter>
      )}

      <ConnectionForm open={formOpen} onClose={() => setFormOpen(false)} />

      {scanTarget && (
        <ScanModal
          open={true}
          onClose={() => setScanTarget(null)}
          connectionId={scanTarget.id}
          defaults={scanTarget.defaults}
        />
      )}

      {removeTarget && (
        <RemoveConnectionDialog
          connectionId={removeTarget.id}
          connectionLabel={removeTarget.label}
          open={true}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
