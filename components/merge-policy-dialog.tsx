"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface MergePolicyDialogProps {
  open: boolean;
  onClose: () => void;
  primaryPolicyId: string;
  secondaryPolicyId: string;
  notificationId?: Id<"notifications">;
}

function PolicySummaryCard({
  policyId,
  label,
}: {
  policyId: string;
  label: string;
}) {
  const policy = useQuery(api.policies.get, {
    id: policyId as Id<"policies">,
  });

  return (
    <div className="flex-1 rounded-md border border-foreground/10 p-3 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wide">
        {label}
      </p>
      {policy === undefined ? (
        <p className="text-body-sm text-muted-foreground/40">Loading...</p>
      ) : policy === null ? (
        <p className="text-body-sm text-muted-foreground/40">Not found</p>
      ) : (
        <>
          <p className="text-body-sm text-foreground font-medium">
            {policy.policyNumber}
          </p>
          {policy.carrier && (
            <p className="text-[11px] text-muted-foreground/70">{policy.carrier}</p>
          )}
          {policy.insuredName && (
            <p className="text-[11px] text-muted-foreground/70">{policy.insuredName}</p>
          )}
          <p className="text-[11px] text-muted-foreground/50">
            {policy.effectiveDate} – {policy.expirationDate}
          </p>
        </>
      )}
    </div>
  );
}

export function MergePolicyDialog({
  open,
  onClose,
  primaryPolicyId,
  secondaryPolicyId,
  notificationId,
}: MergePolicyDialogProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _api = api as any;
  const mergePolicies = useAction(_api.actions.detectDuplicatePolicies.mergePolicies);

  async function handleMerge() {
    try {
      await mergePolicies({
        primaryPolicyId: primaryPolicyId as Id<"policies">,
        secondaryPolicyId: secondaryPolicyId as Id<"policies">,
        notificationId: notificationId || undefined,
      });
      onClose();
    } catch (err) {
      console.error("Merge failed", err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge policies</DialogTitle>
        </DialogHeader>

        <p className="text-body-sm text-muted-foreground">
          The primary policy will be kept and updated with any missing data from the
          secondary. The secondary policy will be removed.
        </p>

        <div className="flex gap-3 mt-1">
          <PolicySummaryCard
            policyId={primaryPolicyId}
            label="Keep (primary)"
          />
          <PolicySummaryCard
            policyId={secondaryPolicyId}
            label="Remove (secondary)"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleMerge}>
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
