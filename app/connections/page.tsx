"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { ConnectionForm } from "@/components/connection-form";
import { ScanModal } from "@/components/scan-modal";
import { ScanStatus } from "@/components/scan-status";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowRight } from "lucide-react";
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
  const connections = useQuery(api.connections.list);
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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="!mb-1">Email Connections</h1>
                <p className="text-body-sm text-muted-foreground">
                  Connect IMAP email inboxes to scan for insurance policies
                </p>
              </div>
              <div className="hidden md:block">
                <PillButton onClick={() => setFormOpen(true)}>
                  Add Connection <ArrowRight className="w-3 h-3" />
                </PillButton>
              </div>
            </div>
          </FadeIn>

          {connections && connections.length === 0 && (
            <FadeIn when={true} delay={0.2} duration={0.6}>
              <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center">
                <Mail className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-body-sm text-muted-foreground mb-1">
                  No email connections yet
                </p>
                <p className="text-label-sm text-muted-foreground/60">
                  Add an IMAP connection to start scanning for insurance
                  policies
                </p>
              </div>
            </FadeIn>
          )}

          <div className="space-y-3">
            {connections?.map((conn, i) => {
              const isScanning = conn.scanProgress && conn.scanProgress.phase !== "complete";

              return (
                <FadeIn
                  key={conn._id}
                  when={true}
                  staggerIndex={i + 1}
                  duration={0.6}
                >
                  <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3">
                    {/* Desktop layout: single row */}
                    <div className="hidden md:flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <ConnectionIcon imapHost={conn.imapHost} className="w-8 h-8 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-body-sm font-medium text-foreground truncate">
                            {conn.label}
                          </p>
                          <p className="text-label-sm text-muted-foreground/60 truncate">
                            {conn.email} · {conn.imapHost}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <ScanStatus
                          status={conn.lastScanStatus}
                          error={conn.lastScanError}
                          progress={conn.scanProgress}
                        />
                        {conn.emailsFound != null && !isScanning && (
                          <span className="text-label-sm text-muted-foreground">
                            {conn.emailsFound} emails ·{" "}
                            {conn.policiesExtracted ?? 0} policies
                          </span>
                        )}
                        {isScanning ? (
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
                        )}
                        <PillButton
                          variant="icon"
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
                          <p className="text-body-sm font-medium text-foreground truncate">
                            {conn.label}
                          </p>
                          <p className="text-label-sm text-muted-foreground/60 truncate">
                            {conn.email} · {conn.imapHost}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <ScanStatus
                          status={conn.lastScanStatus}
                          error={conn.lastScanError}
                          progress={conn.scanProgress}
                        />
                        {conn.emailsFound != null && !isScanning && (
                          <span className="text-label-sm text-muted-foreground">
                            {conn.emailsFound} emails · {conn.policiesExtracted ?? 0} policies
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isScanning ? (
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
                        )}
                        <PillButton
                          variant="icon"
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
        </div>
      </main>

      <FixedMobileFooter>
        <PillButton onClick={() => setFormOpen(true)}>
          Add Connection <ArrowRight className="w-3 h-3" />
        </PillButton>
      </FixedMobileFooter>

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
