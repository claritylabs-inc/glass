"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { ConnectionForm } from "@/components/connection-form";
import { ScanStatus } from "@/components/scan-status";
import { FadeIn } from "@/components/ui/fade-in";
import { CTAButton } from "@/components/ui/cta-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Trash2, Play } from "lucide-react";
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
          <button
            type="button"
            onClick={onClose}
            disabled={removing}
            className="px-4 py-2 rounded-full border border-foreground/8 bg-white text-label font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          {hasPolicies ? (
            <>
              <button
                type="button"
                onClick={() => handleRemove(false)}
                disabled={removing}
                className="px-4 py-2 rounded-full border border-foreground/8 bg-white text-label font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer disabled:opacity-50"
              >
                Keep policies
              </button>
              <button
                type="button"
                onClick={() => handleRemove(true)}
                disabled={removing}
                className="px-5 py-2 rounded-full bg-destructive/10 text-destructive text-label font-medium hover:bg-destructive/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {removing ? "Removing..." : "Remove all"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleRemove(false)}
              disabled={removing}
              className="px-5 py-2 rounded-full bg-destructive/10 text-destructive text-label font-medium hover:bg-destructive/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {removing ? "Removing..." : "Remove"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const connections = useQuery(api.connections.list);
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const [formOpen, setFormOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    id: Id<"emailConnections">;
    label: string;
  } | null>(null);

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
                <CTAButton
                  label="Add Connection"
                  onClick={() => setFormOpen(true)}
                />
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
            {connections?.map((conn, i) => (
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
                      />
                      {conn.emailsFound != null && (
                        <span className="text-label-sm text-muted-foreground">
                          {conn.emailsFound} emails ·{" "}
                          {conn.policiesExtracted ?? 0} policies
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          scanInbox({ connectionId: conn._id })
                        }
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        Scan
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRemoveTarget({ id: conn._id, label: conn.label })
                        }
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
                      />
                      {conn.emailsFound != null && (
                        <span className="text-label-sm text-muted-foreground">
                          {conn.emailsFound} emails · {conn.policiesExtracted ?? 0} policies
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => scanInbox({ connectionId: conn._id })}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        Scan
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveTarget({ id: conn._id, label: conn.label })}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </main>

      <FixedMobileFooter>
        <CTAButton
          label="Add Connection"
          onClick={() => setFormOpen(true)}
        />
      </FixedMobileFooter>

      <ConnectionForm open={formOpen} onClose={() => setFormOpen(false)} />

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
