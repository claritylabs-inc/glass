"use client";

import dayjs from "dayjs";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, MessageSquareLock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
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

function jobLabel(state: ImessagePrivacyState): {
  label: string;
  tone: StatusTagTone;
} {
  const deletion = state.deletion;
  if (deletion?.status === "queued" || deletion?.status === "running") {
    return { label: "Deleting", tone: "warning" };
  }
  if (state.preview?.status === "preparing") {
    return { label: "Inventorying", tone: "info" };
  }
  if (state.preview?.status === "ready") {
    return { label: "Ready to review", tone: "warning" };
  }
  if (state.preview?.status === "failed" || deletion?.status === "failed") {
    return { label: "Needs retry", tone: "danger" };
  }
  if (state.latestCompleted) {
    return { label: "Last deletion complete", tone: "success" };
  }
  return { label: "Available", tone: "neutral" };
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
  const status = state ? jobLabel(state) : null;
  const active =
    state?.deletion?.status === "queued" ||
    state?.deletion?.status === "running";
  const previewReady = state?.preview?.status === "ready";
  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Personal iMessage history"
        description="Manage direct conversations between your phone number and Glass."
        action={
          status ? (
            <StatusTag tone={status.tone}>{status.label}</StatusTag>
          ) : null
        }
      />
      <OperationalPanelBody className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground">
            <MessageSquareLock className="size-4" />
          </span>
          <div className="min-w-0">
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              Delete conversations stored by Glass
            </p>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              This does not delete messages from Apple Messages, group chats, or
              business records such as policies, certificates, and delivery
              outcomes.
            </p>
          </div>
        </div>
        {active && state?.deletion ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            {state.deletion.processedThreadCount} of{" "}
            {state.deletion.threadCount} conversations processed. You can leave
            this page while deletion continues.
          </p>
        ) : null}
        <div>
          <PillButton
            variant="destructive"
            disabled={busy || active || state === undefined}
            onClick={previewReady ? onReview : onPrepare}
          >
            {busy || state === undefined ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {previewReady
              ? "Review deletion"
              : state?.preview?.status === "failed" ||
                  state?.deletion?.status === "failed"
                ? "Prepare retry"
                : "Delete iMessage history"}
          </PillButton>
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

export function ImessagePrivacyDrawer({
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
  const canConfirm =
    ready && !blocked && !busy && (preview?.threadCount ?? 0) > 0;

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Delete personal iMessage history"
      footer={
        <>
          <PillButton
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          {ready ? (
            <PillButton
              variant="destructive"
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Permanently delete
            </PillButton>
          ) : (
            <PillButton disabled={busy || preparing} onClick={onPrepare}>
              {busy || preparing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Prepare inventory
            </PillButton>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <MessageSquareLock className="size-4" />
          </span>
          <div>
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              This action cannot be undone in Glass.
            </p>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Only your personal, direct iMessage conversations are included.
              Organization-visible and group conversations are excluded.
            </p>
          </div>
        </div>

        {preparing ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-foreground/[0.02] p-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className={typeStyle("body.default")}>
              Counting eligible conversations and attachments…
            </span>
          </div>
        ) : null}

        {failed ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
            <p className={`text-destructive ${typeStyle("body.medium")}`}>
              Glass could not finish the deletion workflow
            </p>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Prepare a fresh inventory to retry safely from the remaining
              history.
            </p>
          </div>
        ) : null}

        {ready ? (
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Conversations", preview.threadCount],
              ["Messages", preview.messageCount],
              ["Files", preview.fileCount],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-border bg-foreground/[0.02] p-3"
              >
                <p className={`text-foreground ${typeStyle("heading.micro")}`}>
                  {String(value)}
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {String(label)}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {ready && preview.readyAt ? (
          <p
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Inventory prepared{" "}
            {dayjs(preview.readyAt).format("MMM D, YYYY h:mm A")}. It expires
            after five minutes so the confirmation stays current.
          </p>
        ) : null}

        {blocked ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <p
              className={`text-amber-800 dark:text-amber-300 ${typeStyle("body.medium")}`}
            >
              An iMessage response is active
            </p>
            <p
              className={`mt-1 text-amber-800/80 dark:text-amber-300/80 ${typeStyle("body.default")}`}
            >
              Wait for it to finish, then prepare a fresh inventory before
              deleting.
            </p>
          </div>
        ) : null}

        {(preview?.threadCount ?? 0) === 0 && ready ? (
          <div className="flex items-start gap-2 rounded-lg border border-border p-3">
            <ShieldCheck className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" />
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Glass found no eligible personal direct-iMessage history.
            </p>
          </div>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

export function useImessagePrivacyActions(
  privacy: ReturnType<typeof useImessagePrivacy>,
  setBusy: (busy: boolean) => void,
  setOpen: (open: boolean) => void,
) {
  const prepare = async () => {
    setBusy(true);
    setOpen(true);
    try {
      await privacy.preparePreview({});
    } catch (error) {
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
      className="mb-4 flex items-center gap-1 border-b border-border pb-2"
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
