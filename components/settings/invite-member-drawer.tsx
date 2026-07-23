"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

const INPUT_CLASSES =
  "h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label font-medium text-muted-foreground block mb-1";

export function InviteMemberDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const sendMemberInvitation = useAction(api.orgs.sendMemberInvitation);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);

  function resetAndClose() {
    setEmail("");
    setRole("member");
    onOpenChange(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    try {
      await sendMemberInvitation({ email, role });
      toast.success(`Invitation sent to ${email}`);
      resetAndClose();
    } catch (err) {
      const msg = getUserFacingErrorMessage(err, "Failed to send invitation");
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) resetAndClose();
        else onOpenChange(true);
      }}
      title="Invite team member"
      footer={
        <PillButton
          type="submit"
          form="invite-member-form"
          variant="primary"
          disabled={sending || !email}
        >
          {sending ? "Sending…" : "Send invitation"}
        </PillButton>
      }
    >
      <form
        id="invite-member-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <p className="text-base text-muted-foreground">
          Send an invitation to join your organization. They&apos;ll receive an
          email with instructions.
        </p>

        <div>
          <label htmlFor="invite-email" className={LABEL_CLASSES}>
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className={INPUT_CLASSES}
          />
        </div>

        <div>
          <span className={LABEL_CLASSES}>Role</span>
          <div className="flex gap-2">
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 py-2 rounded-lg border text-base font-medium transition-colors ${
                  role === r
                    ? "border-foreground/15 bg-foreground/3 text-foreground"
                    : "border-foreground/6 text-muted-foreground hover:border-foreground/10"
                }`}
              >
                {r === "admin" ? "Admin" : "Member"}
              </button>
            ))}
          </div>
          <p className="text-label text-muted-foreground/60 mt-1.5">
            {role === "admin"
              ? "Admins can manage connections, settings, and team members."
              : "Members can view policies and use the agent, but can't manage connections or settings."}
          </p>
        </div>
      </form>
    </SettingsDrawer>
  );
}
