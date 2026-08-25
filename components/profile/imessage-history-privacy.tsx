"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export type ImessagePrivacyState = FunctionReturnType<
  typeof api.imessagePrivacy.getPersonalImessageDeletionState
>;

export function useImessagePrivacy() {
  const state = useQuery(
    api.imessagePrivacy.getPersonalImessageDeletionState,
    {},
  );
  const preparePreview = useMutation(
    api.imessagePrivacy.preparePersonalImessageDeletionPreview,
  );
  const requestDeletion = useMutation(
    api.imessagePrivacy.requestPersonalImessageDeletion,
  );
  return { state, preparePreview, requestDeletion };
}

export function ImessagePrivacyPanel({
  state,
  busy,
  onPrepare,
  onReview,
}: {
  state: ImessagePrivacyState | undefined;
  busy: boolean;
  onPrepare: () => void;
  onReview: () => void;
}) {
  const active =
    state?.deletion?.status === "queued" ||
    state?.deletion?.status === "running";
  const previewReady = state?.preview?.status === "ready";
  const previewPreparing = state?.preview?.status === "preparing";
  const previewFailed =
    state?.preview?.status === "failed" ||
    state?.deletion?.status === "failed";
  const noHistory =
    previewReady && (state.preview?.threadCount ?? 0) === 0;
  const description = noHistory
    ? "There is no iMessage history to delete."
    : "This does not delete messages from Apple Messages, group chats, or business records such as policies, certificates, and delivery outcomes.";
  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Personal iMessage history" />
      <OperationalPanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Delete conversations stored by Glass
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {description}
          </p>
          {active && state?.deletion ? (
            <p
              className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}
            >
              {state.deletion.processedThreadCount} of{" "}
              {state.deletion.threadCount} conversations processed. You can
              leave this page while deletion continues.
            </p>
          ) : null}
          {previewFailed ? (
            <p
              className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Glass couldn’t check your iMessage history. Try again.
            </p>
          ) : null}
        </div>
        <PillButton
          className="self-start sm:self-center"
          variant="destructive"
          disabled={
            busy ||
            active ||
            previewPreparing ||
            noHistory ||
            state === undefined
          }
          onClick={previewReady ? onReview : onPrepare}
        >
          {busy || previewPreparing || state === undefined ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Delete iMessage history
        </PillButton>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function ImessagePrivacyDialog({
  open,
  onOpenChange,
  state,
  busy,
  onPrepare,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ImessagePrivacyState | undefined;
  busy: boolean;
  onPrepare: () => void;
  onConfirm: () => void;
}) {
  const preview = state?.preview;
  const preparing = preview?.status === "preparing";
  const ready = preview?.status === "ready";
  const failed =
    preview?.status === "failed" || state?.deletion?.status === "failed";
  const blocked = state?.hasActiveAgentTurn === true;
  const hasHistory = ready && (preview?.threadCount ?? 0) > 0;
  const checking =
    state === undefined || preparing || (busy && !ready) || (!preview && !failed);
  const canConfirm = hasHistory && !blocked && !busy;

  const title = checking
    ? "Checking iMessage history…"
    : failed
      ? "Couldn’t check iMessage history"
      : !hasHistory
        ? "There is no iMessage history to delete"
        : "Delete personal iMessage history?";

  return (
    <Dialog
      open={open && (!ready || hasHistory)}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hasHistory ? (
            <DialogDescription>
              <strong>{countLabel(preview.threadCount, "conversation")}</strong>
              , <strong>{countLabel(preview.messageCount, "message")}</strong>,
              and <strong>{countLabel(preview.fileCount, "file")}</strong> will
              be permanently deleted from Glass.
              {blocked
                ? " Wait for the active iMessage response to finish, then try again."
                : null}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogFooter>
          {hasHistory && !blocked ? (
            <>
              <PillButton
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </PillButton>
              <PillButton
                variant="destructive"
                disabled={!canConfirm}
                onClick={onConfirm}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Permanently delete
              </PillButton>
            </>
          ) : failed ? (
            <>
              <PillButton
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </PillButton>
              <PillButton disabled={busy} onClick={onPrepare}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Try again
              </PillButton>
            </>
          ) : (
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {checking ? "Cancel" : "Close"}
            </PillButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useImessagePrivacyActions(
  privacy: ReturnType<typeof useImessagePrivacy>,
  setBusy: (busy: boolean) => void,
  setOpen: (open: boolean) => void,
) {
  const pendingPreviewJobId = useRef<
    NonNullable<ImessagePrivacyState["preview"]>["id"] | null
  >(null);

  useEffect(() => {
    const preview = privacy.state?.preview;
    if (!preview || preview.id !== pendingPreviewJobId.current) return;
    if (preview.status === "ready") {
      pendingPreviewJobId.current = null;
      if (preview.threadCount > 0) setOpen(true);
    } else if (preview.status === "failed") {
      pendingPreviewJobId.current = null;
    }
  }, [privacy.state?.preview, setOpen]);

  const prepare = async () => {
    setBusy(true);
    try {
      const result = await privacy.preparePreview({});
      pendingPreviewJobId.current = result.previewJobId;
    } catch (error) {
      pendingPreviewJobId.current = null;
      toast.error(
        getUserFacingErrorMessage(error, "Could not prepare deletion"),
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const previewJobId = privacy.state?.preview?.id;
    if (!previewJobId) return;
    setBusy(true);
    try {
      await privacy.requestDeletion({ previewJobId });
      toast.success("Personal iMessage history deletion started");
      setOpen(false);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not start deletion"));
    } finally {
      setBusy(false);
    }
  };
  return { prepare, confirm };
}

export function ProfileSectionTabs({
  active,
  onChange,
}: {
  active: "profile" | "privacy";
  onChange: (value: "profile" | "privacy") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      className="mb-4 flex items-center gap-1"
    >
      <PillButton
        variant={active === "profile" ? "primary" : "ghost"}
        size="compact"
        role="tab"
        aria-selected={active === "profile"}
        onClick={() => onChange("profile")}
      >
        Profile
      </PillButton>
      <PillButton
        variant={active === "privacy" ? "primary" : "ghost"}
        size="compact"
        role="tab"
        aria-selected={active === "privacy"}
        onClick={() => onChange("privacy")}
      >
        Privacy
      </PillButton>
    </div>
  );
}
