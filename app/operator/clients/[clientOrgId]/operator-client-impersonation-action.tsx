"use client";

import { useState } from "react";
import { Loader2, LogOut, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { useStartOperatorImpersonation } from "@/hooks/use-start-operator-impersonation";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import type { OperatorImpersonationTarget } from "@/lib/operator-navigation";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type OperatorClientImpersonationActionProps = {
  clientOrgId: Id<"organizations"> | string;
  activeImpersonation: OperatorImpersonationTarget | null | undefined;
  beforeStart?: () => Promise<boolean | void>;
  disabled?: boolean;
};

export function OperatorClientImpersonationAction({
  clientOrgId,
  activeImpersonation,
  beforeStart,
  disabled = false,
}: OperatorClientImpersonationActionProps) {
  const { startImpersonation, status: startStatus } =
    useStartOperatorImpersonation();
  const stopOperatorImpersonation =
    useStopOperatorImpersonation(activeImpersonation);
  const [busy, setBusy] = useState(false);
  const isImpersonating = Boolean(activeImpersonation);

  async function toggleImpersonation() {
    setBusy(true);
    try {
      if (isImpersonating) {
        await stopOperatorImpersonation();
        toast.success("Impersonation stopped");
        return;
      }

      if ((await beforeStart?.()) === false) return;
      await startImpersonation({
        targetOrgId: clientOrgId as Id<"organizations">,
        targetRole: "admin",
        destination: "/policies",
        failureMessage: "Failed to impersonate client",
      });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          isImpersonating
            ? "Failed to stop impersonating"
            : "Failed to impersonate client",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PillButton
      size="compact"
      variant="icon"
      label={
        busy
          ? isImpersonating
            ? "Stopping…"
            : "Starting…"
          : isImpersonating
            ? "Stop impersonating"
            : startStatus === "retry"
              ? "Retry impersonation"
              : "Impersonate"
      }
      expandLabel
      disabled={disabled || busy}
      onClick={() => void toggleImpersonation()}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : isImpersonating ? (
        <LogOut className="size-3.5" />
      ) : (
        <UserRoundCog className="size-3.5" />
      )}
    </PillButton>
  );
}
