"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

export function InviteClientDrawer({
  partnerOrgId,
  open,
  onOpenChange,
  resumeClientOrgId,
}: {
  partnerOrgId: Id<"organizations">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resumeClientOrgId?: Id<"organizations"> | null;
}) {
  const [draftId, setDraftId] = useState<Id<"organizations"> | null>(null);
  const [contactEmailInput, setContactEmailInput] = useState<string | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const createDraft = useMutation(api.clientInvitations.createDraftClient);
  const updateDraft = useMutation(api.clientInvitations.updateDraftClient);
  const sendInvite = useAction(api.clientInvitations.sendDraftInvite);

  const hydrateDraft = useQuery(
    api.clientInvitations.getDraftClient,
    resumeClientOrgId ? { clientOrgId: resumeClientOrgId } : "skip",
  );

  const resumedDraftId =
    open && hydrateDraft && resumeClientOrgId ? resumeClientOrgId : null;
  const activeDraftId = draftId ?? resumedDraftId;
  const contactEmail =
    contactEmailInput ?? hydrateDraft?.primaryContactEmail ?? "";

  const emailValid = contactEmail.includes("@") && contactEmail.includes(".");
  const canCreateDraft = emailValid && !activeDraftId;

  async function ensureDraft(): Promise<Id<"organizations"> | null> {
    if (activeDraftId) return activeDraftId;
    if (!canCreateDraft) return null;
    try {
      const { clientOrgId } = await createDraft({
        brokerOrgId: partnerOrgId,
        primaryContactEmail: contactEmail.trim(),
      });
      setDraftId(clientOrgId);
      return clientOrgId;
    } catch (err) {
      toast.error(String(err));
      return null;
    }
  }

  // Create the draft as soon as company name + email are both filled.
  useEffect(() => {
    if (!canCreateDraft) return;
    let cancelled = false;
    createDraft({
      brokerOrgId: partnerOrgId,
      primaryContactEmail: contactEmail.trim(),
    })
      .then(({ clientOrgId }) => {
        if (!cancelled) setDraftId(clientOrgId);
      })
      .catch((err) => {
        if (!cancelled) toast.error(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [canCreateDraft, contactEmail, createDraft, partnerOrgId]);

  // Patch draft on field blur.
  async function commitField(field: "primaryContactEmail", value: string) {
    if (!activeDraftId) return;
    try {
      await updateDraft({ clientOrgId: activeDraftId, [field]: value });
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function persistPendingEdits(id: Id<"organizations">) {
    await updateDraft({
      clientOrgId: id,
      primaryContactEmail: contactEmail.trim(),
    });
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const id = await ensureDraft();
    if (!id) {
      toast.error("Enter a valid email first");
      return;
    }
    setSending(true);
    try {
      await persistPendingEdits(id);
      await sendInvite({ clientOrgId: id });
      toast.success(`Invite sent to ${contactEmail}`);
      resetAndClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleCreateWithoutSending() {
    const id = await ensureDraft();
    if (!id) {
      toast.error("Enter a valid email first");
      return;
    }
    setSavingDraft(true);
    try {
      await persistPendingEdits(id);
      toast.success(`Client created — you can now add policies`);
      resetAndClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSavingDraft(false);
    }
  }

  function resetAndClose() {
    setDraftId(null);
    setContactEmailInput("");
    onOpenChange(false);
  }

  const isResuming = !!resumeClientOrgId;
  const title = isResuming ? "Resume draft" : "Invite client";

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) resetAndClose();
        else onOpenChange(true);
      }}
      title={title}
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={!emailValid || sending || savingDraft}
            onClick={handleCreateWithoutSending}
          >
            {savingDraft ? "Saving…" : "Create without sending"}
          </PillButton>
          <PillButton
            type="submit"
            form="invite-client-form"
            variant="primary"
            disabled={!emailValid || sending || savingDraft}
          >
            {sending ? "Sending…" : "Send invite"}
          </PillButton>
        </>
      }
    >
      <form id="invite-client-form" onSubmit={handleSend} className="space-y-4">
        <div>
          <label htmlFor="contactEmail" className={LABEL_CLASSES}>
            Client email
          </label>
          <input
            id="contactEmail"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmailInput(e.target.value)}
            onBlur={() =>
              commitField("primaryContactEmail", contactEmail.trim())
            }
            placeholder="jane@acmecorp.com"
            className={INPUT_CLASSES}
          />
        </div>
      </form>
    </SettingsDrawer>
  );
}
