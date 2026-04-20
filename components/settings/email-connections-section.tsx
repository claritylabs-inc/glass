"use client";

import { useState, useEffect } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { ConnectionForm } from "@/components/connection-form";
import { ScanModal } from "@/components/scan-modal";
import { ScanStatus } from "@/components/scan-status";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, Trash2, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { ConnectionIcon } from "@/components/connection-icon";
import { getScanCoverageLabel } from "@/components/pull-more-dropdown";
import { EmailReviewTable } from "@/components/email-review-table";
import { ScanCalendarDialog } from "@/components/scan-calendar-dialog";
import { Id } from "@/convex/_generated/dataModel";

/* ── RemoveConnectionDialog ── */
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
                <strong>
                  {counts.policyCount} extracted{" "}
                  {counts.policyCount === 1 ? "policy" : "policies"}
                </strong>
                . Would you like to remove those as well?
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
              <PillButton
                variant="secondary"
                onClick={() => handleRemove(false)}
                disabled={removing}
              >
                Keep policies
              </PillButton>
              <PillButton
                variant="destructive"
                onClick={() => handleRemove(true)}
                disabled={removing}
              >
                {removing ? "Removing..." : "Remove all"}
              </PillButton>
            </>
          ) : (
            <PillButton
              variant="destructive"
              onClick={() => handleRemove(false)}
              disabled={removing}
            >
              {removing ? "Removing..." : "Remove"}
            </PillButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── EmailConnectionsSection (main export) ── */
export function EmailConnectionsSection() {
  const router = useRouter();
  const pathname = usePathname();

  const connections = useQuery(api.connections.list);
  const createOAuthState = useMutation(api.connections.createOAuthStateForViewer);

  const [formOpen, setFormOpen] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<Id<"emailConnections"> | null>(null);

  const { setActions } = useSettingsActions();

  useEffect(() => {
    setActions(
      <PillButton size="compact" onClick={() => setFormOpen(true)}>
        Add Connection
      </PillButton>
    );
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScan = useMutation(api.connections.stopScan);
  const removeDemoData = useMutation(api.seed.removeDemoData);

  const handleReconnectGoogle = async (connectionId: Id<"emailConnections">) => {
    const state = crypto.randomUUID();
    setReconnectingId(connectionId);
    try {
      await createOAuthState({
        state,
        returnTo: "/settings?section=email-connections",
      });
      window.location.href = `/api/auth/google/start?state=${encodeURIComponent(state)}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start Google reconnect");
      setReconnectingId(null);
    }
  };

  const [scanTarget, setScanTarget] = useState<{
    id: Id<"emailConnections">;
    provider?: "google" | "imap";
    defaults?: {
      sinceDate?: string;
      untilDate?: string;
      senderDomains?: string[];
      lastScanAt?: number;
    };
  } | null>(null);

  const [removeTarget, setRemoveTarget] = useState<{
    id: Id<"emailConnections">;
    label: string;
  } | null>(null);

  const [showRemoveDemo, setShowRemoveDemo] = useState(false);
  const [removingDemo, setRemovingDemo] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<{
    id: Id<"emailConnections">;
    provider?: "google" | "imap";
  } | null>(null);

  // Scanned emails state
  const [selectedConnectionId, setSelectedConnectionId] =
    useState<Id<"emailConnections"> | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Id<"emails">[]>([]);
  const updateClassification = useMutation(api.emails.updateClassification);
  const bulkReclassify = useMutation(api.emails.bulkReclassify);

  const firstConnectionId = connections?.[0]?._id ?? null;
  const emailsConnectionId = selectedConnectionId ?? firstConnectionId;

  const handleBulkClassify = async (isInsurance: boolean) => {
    for (const id of selectedEmailIds) {
      await updateClassification({ id, isInsuranceRelated: isInsurance });
    }
    toast.success(`${selectedEmailIds.length} emails updated`);
    setSelectedEmailIds([]);
  };

  const handleBulkRescan = async () => {
    await bulkReclassify({ ids: selectedEmailIds });
    toast.success(
      `${selectedEmailIds.length} emails queued for reclassification`
    );
    setSelectedEmailIds([]);
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="accounts">
        <TabsList variant="pill">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="emails">Scanned emails</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
        <div className="pt-4">

        {connections === undefined && (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-foreground/6 bg-card px-4 py-3"
              >
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
            <div className="rounded-lg border border-foreground/6 bg-card px-6 py-8 text-center">
              <p className="text-body-sm text-muted-foreground/60">
                No email connections yet
              </p>
            </div>
          </FadeIn>
        )}

        <div className="space-y-3">
          {connections?.map((conn, i) => {
            const isScanning =
              conn.scanProgress && conn.scanProgress.phase !== "complete";
            const isDemo = conn.isDemo === true;

            return (
              <FadeIn key={conn._id} when={true} staggerIndex={i + 2} duration={0.6}>
                <div
                  className={`rounded-lg border px-4 py-3 ${
                    isDemo
                      ? "border-amber-200/60 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/20"
                      : "border-foreground/6 bg-card"
                  }`}
                >
                  {/* Desktop layout */}
                  <div className="hidden md:flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      {!isDemo && (
                        <ConnectionIcon
                          imapHost={conn.imapHost}
                          provider={conn.provider}
                          className="w-8 h-8 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-body-sm font-medium text-foreground truncate">
                            {conn.label}
                          </p>
                          {isDemo && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">
                              Demo
                            </span>
                          )}
                          {!isDemo && conn.provider === "google" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                              OAuth
                            </span>
                          )}
                        </div>
                        <p className="text-label-sm text-muted-foreground/60 truncate">
                          {conn.provider === "google"
                            ? conn.email
                            : `${conn.email} · ${conn.imapHost}`}
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
                      {!isDemo && !isScanning && conn.lastScanAt && (
                        <span className="text-label-sm text-muted-foreground/50">
                          {getScanCoverageLabel(
                            conn.lastScanParams?.sinceDate,
                            conn.lastScanAt
                          )}
                        </span>
                      )}
                      {!isDemo &&
                        conn.provider === "google" &&
                        conn.lastScanStatus === "disconnected" && (
                          <PillButton
                            variant="secondary"
                            onClick={() => handleReconnectGoogle(conn._id)}
                            disabled={reconnectingId === conn._id}
                          >
                            <RefreshCw className="w-3 h-3" />
                            {reconnectingId === conn._id ? "Connecting..." : "Reconnect"}
                          </PillButton>
                        )}
                      {!isDemo &&
                        (isScanning ? (
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
                            onClick={() =>
                              setCalendarTarget({
                                id: conn._id,
                                provider: conn.provider as
                                  | "google"
                                  | "imap"
                                  | undefined,
                              })
                            }
                          >
                            Manage
                          </PillButton>
                        ))}
                      <PillButton
                        variant="icon"
                        label="Remove"
                        onClick={() =>
                          isDemo
                            ? setShowRemoveDemo(true)
                            : setRemoveTarget({ id: conn._id, label: conn.label })
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </PillButton>
                    </div>
                  </div>

                  {/* Mobile layout */}
                  <div className="md:hidden space-y-3">
                    <div className="flex items-center gap-3">
                      {!isDemo && (
                        <ConnectionIcon
                          imapHost={conn.imapHost}
                          provider={conn.provider}
                          className="w-8 h-8 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-body-sm font-medium text-foreground truncate">
                            {conn.label}
                          </p>
                          {isDemo && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">
                              Demo
                            </span>
                          )}
                          {!isDemo && conn.provider === "google" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                              OAuth
                            </span>
                          )}
                        </div>
                        <p className="text-label-sm text-muted-foreground/60 truncate">
                          {conn.provider === "google"
                            ? conn.email
                            : `${conn.email} · ${conn.imapHost}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
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
                      {!isDemo && !isScanning && conn.lastScanAt && (
                        <span className="text-label-sm text-muted-foreground/50">
                          ·{" "}
                          {getScanCoverageLabel(
                            conn.lastScanParams?.sinceDate,
                            conn.lastScanAt
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isDemo &&
                        conn.provider === "google" &&
                        conn.lastScanStatus === "disconnected" && (
                          <PillButton
                            variant="secondary"
                            onClick={() => handleReconnectGoogle(conn._id)}
                            disabled={reconnectingId === conn._id}
                          >
                            <RefreshCw className="w-3 h-3" />
                            {reconnectingId === conn._id ? "Connecting..." : "Reconnect"}
                          </PillButton>
                        )}
                      {!isDemo &&
                        (isScanning ? (
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
                            onClick={() =>
                              setCalendarTarget({
                                id: conn._id,
                                provider: conn.provider as
                                  | "google"
                                  | "imap"
                                  | undefined,
                              })
                            }
                          >
                            Manage
                          </PillButton>
                        ))}
                      <PillButton
                        variant="icon"
                        label="Remove"
                        onClick={() =>
                          isDemo
                            ? setShowRemoveDemo(true)
                            : setRemoveTarget({ id: conn._id, label: conn.label })
                        }
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
        </div>
        </TabsContent>

        <TabsContent value="emails">
        <div className="pt-4">
        {selectedEmailIds.length > 0 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() => handleBulkClassify(true)}
            >
              Mark Insurance
            </PillButton>
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() => handleBulkClassify(false)}
            >
              Mark Not Insurance
            </PillButton>
            <PillButton
              size="compact"
              variant="secondary"
              onClick={handleBulkRescan}
            >
              Rescan
            </PillButton>
          </div>
        )}

        {connections && connections.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 mb-3">
            {connections.map((conn) => {
              const isSelected = conn._id === emailsConnectionId;
              return (
                <button
                  key={conn._id}
                  type="button"
                  onClick={() => setSelectedConnectionId(conn._id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all cursor-pointer shrink-0 ${
                    isSelected
                      ? "bg-foreground text-background"
                      : "border border-foreground/8 bg-popover text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02]"
                  }`}
                >
                  <ConnectionIcon
                    imapHost={conn.imapHost}
                    provider={conn.provider}
                    className={`w-7 h-7 shrink-0 ${isSelected ? "!bg-background/20" : ""}`}
                  />
                  <div className="min-w-0">
                    <p
                      className={`text-body-sm font-medium truncate leading-tight ${isSelected ? "text-background" : "text-foreground"}`}
                    >
                      {conn.label}
                    </p>
                    <p
                      className={`text-label-sm truncate leading-tight ${isSelected ? "text-background/60" : "text-muted-foreground/50"}`}
                    >
                      {conn.email}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {emailsConnectionId ? (
          <EmailReviewTable
            connectionId={emailsConnectionId}
            onSelectionChange={setSelectedEmailIds}
          />
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card px-6 py-8 text-center">
            <p className="text-body-sm text-muted-foreground/60">
              No connections available. Add a connection first.
            </p>
          </div>
        )}
        </div>
        </TabsContent>
      </Tabs>

      {/* ── Modals ── */}
      <ConnectionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />

      {scanTarget && (
        <ScanModal
          open={true}
          onClose={() => setScanTarget(null)}
          onScanStarted={() => router.push(`${pathname}?section=email-connections`)}
          connectionId={scanTarget.id}
          provider={scanTarget.provider}
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

      <Dialog
        open={showRemoveDemo}
        onOpenChange={(v) => !v && setShowRemoveDemo(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove Demo Data</DialogTitle>
            <DialogDescription>
              This will remove all demo connections, emails, policies, and
              quotes. Your real data will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowRemoveDemo(false)}
              disabled={removingDemo}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={removingDemo}
              onClick={async () => {
                setRemovingDemo(true);
                try {
                  await removeDemoData();
                  setShowRemoveDemo(false);
                  toast.success("Demo data removed");
                } catch {
                  toast.error("Failed to remove demo data");
                } finally {
                  setRemovingDemo(false);
                }
              }}
            >
              {removingDemo ? "Removing..." : "Remove demo data"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {calendarTarget && (
        <ScanCalendarDialog
          open={true}
          onClose={() => setCalendarTarget(null)}
          connectionId={calendarTarget.id}
          provider={calendarTarget.provider}
        />
      )}
    </div>
  );
}
