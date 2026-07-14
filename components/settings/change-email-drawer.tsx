"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";

const inputClass =
  "h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:bg-foreground/[0.02] disabled:text-muted-foreground/60";
const labelClass = "text-label font-medium text-muted-foreground";
const helpClass = "text-label text-muted-foreground/60";
const errorClass = "text-label text-red-500/80";

type PendingEmailChange = NonNullable<
  FunctionReturnType<typeof api.users.getMyPendingEmailChange>
>;

function availabilityCopy(reason?: string) {
  if (reason === "invalid") return "Enter a valid email address.";
  if (reason === "current") return "That is already the current email address.";
  if (reason === "pending") return "This email already has a pending change request.";
  return "This email is already used by another user.";
}

function PendingEmailChangeBlock({
  pending,
  code,
  setCode,
}: {
  pending: PendingEmailChange;
  code: string;
  setCode: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2">
        <p className="text-label text-muted-foreground">Pending email</p>
        <p className="truncate text-base font-medium text-foreground">
          {pending.newEmail}
        </p>
      </div>
      <div className="space-y-1.5">
        <span className={labelClass}>Verification code</span>
        <OtpField value={code} onValueChange={setCode} />
      </div>
    </div>
  );
}

export function SelfEmailChangeDrawer({
  open,
  onOpenChange,
  currentEmail,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail?: string | null;
  onConfirmed: (email: string) => void;
}) {
  const pending = useQuery(
    api.users.getMyPendingEmailChange,
    open ? {} : "skip",
  );
  const requestEmailChange = useAction(api.users.requestEmailChange);
  const confirmEmailChange = useMutation(api.users.confirmEmailChange);
  const cancelEmailChange = useMutation(api.users.cancelEmailChange);

  const [email, setEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEmail(email.trim()), 250);
    return () => clearTimeout(timer);
  }, [email]);

  const trimmedEmail = email.trim();
  const shouldCheck = open && !pending && trimmedEmail.length > 0;
  const availability = useQuery(
    api.users.checkEmailAvailability,
    shouldCheck && debouncedEmail === trimmedEmail
      ? { email: debouncedEmail }
      : "skip",
  );
  const checking =
    shouldCheck && (debouncedEmail !== trimmedEmail || availability === undefined);
  const unavailable = availability?.available === false;
  const requestDisabled =
    requesting || checking || !trimmedEmail || unavailable || pending === undefined;
  const confirmDisabled =
    confirming || !pending || code.length < 6 || pending === undefined;

  async function requestChange() {
    if (requestDisabled) return;
    setRequesting(true);
    setError("");
    try {
      const result = await requestEmailChange({ email: trimmedEmail });
      setEmail("");
      setCode("");
      toast.success(`Verification code sent to ${result.newEmail}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to request email change";
      setError(message);
      toast.error(message);
    } finally {
      setRequesting(false);
    }
  }

  async function confirmChange() {
    if (!pending || confirmDisabled) return;
    setConfirming(true);
    setError("");
    try {
      const result = await confirmEmailChange({
        requestId: pending.requestId,
        code,
      });
      onConfirmed(result.email);
      toast.success("Email updated");
      closeDrawer(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to confirm email change";
      setError(message);
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  }

  async function cancelChange() {
    if (!pending) return;
    setCancelling(true);
    setError("");
    try {
      await cancelEmailChange({ requestId: pending.requestId });
      setCode("");
      toast.success("Email change cancelled");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to cancel email change";
      setError(message);
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  }

  function closeDrawer(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail("");
      setCode("");
      setError("");
    }
    onOpenChange(nextOpen);
  }

  const footer =
    pending ? (
      <>
        <PillButton
          variant="secondary"
          onClick={cancelChange}
          disabled={cancelling || confirming}
        >
          {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Cancel request
        </PillButton>
        <PillButton onClick={confirmChange} disabled={confirmDisabled}>
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Confirm change
        </PillButton>
      </>
    ) : (
      <PillButton onClick={requestChange} disabled={requestDisabled}>
        {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Request change
      </PillButton>
    );

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={closeDrawer}
      title="Change email"
      footer={footer}
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className={labelClass}>Current email</span>
          <input value={currentEmail ?? ""} disabled className={inputClass} />
        </label>

        {pending === undefined ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : pending ? (
          <PendingEmailChangeBlock
            pending={pending}
            code={code}
            setCode={setCode}
          />
        ) : (
          <label className="block space-y-1.5">
            <span className={labelClass}>New email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
              placeholder="name@example.com"
              className={inputClass}
            />
            <span className={unavailable ? errorClass : helpClass}>
              {checking
                ? "Checking email"
                : unavailable
                  ? availabilityCopy(availability.reason)
                  : "A verification code will be sent to this address."}
            </span>
          </label>
        )}

        {error ? <p className={errorClass}>{error}</p> : null}
      </div>
    </SettingsDrawer>
  );
}
