"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSettingsActions } from "@/app/settings/page";

export function BrokerAgentTab() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const updateOrg = useMutation(api.orgs.updateOrg);

  const org = viewerOrg?.org as
    | {
        chatEmailNotifications?: boolean;
        autoSendEmails?: boolean;
        emailSendDelay?: number;
      }
    | undefined;

  const [chatEmailNotifications, setChatEmailNotifications] = useState(false);
  const [autoSendEmails, setAutoSendEmails] = useState(false);
  const [emailSendDelay, setEmailSendDelay] = useState<number>(5);

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { setActions } = useSettingsActions();

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setChatEmailNotifications(org.chatEmailNotifications ?? false);
      setAutoSendEmails(org.autoSendEmails ?? false);
      setEmailSendDelay(org.emailSendDelay ?? 5);
      hydratedRef.current = true;
    }
  }, [org]);

  const saveNow = useCallback(async () => {
    setSaving(true);
    try {
      await updateOrg({
        chatEmailNotifications,
        autoSendEmails,
        emailSendDelay,
      });
      setSavedAt(Date.now());
    } catch {
      toast.error("Failed to save agent settings");
    } finally {
      setSaving(false);
    }
  }, [updateOrg, chatEmailNotifications, autoSendEmails, emailSendDelay]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveNow();
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [saveNow]);

  useEffect(() => {
    setActions(
      <span className="text-label-sm text-muted-foreground flex items-center gap-1.5">
        {saving ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving
          </>
        ) : savedAt ? (
          "Saved"
        ) : null}
      </span>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, savedAt]);

  if (viewerOrg === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const delayOptions = [0, 3, 5, 10, 15];

  return (
    <div className="space-y-4">
      {/* Email behavior */}
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Email behavior</h3>
        </div>
        <div className="px-5 py-2 divide-y divide-foreground/6">
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-body-sm font-medium text-foreground">
                Email notifications for chat responses
              </p>
              <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
                Send email notifications when the agent replies in email threads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setChatEmailNotifications((v) => !v)}
              role="switch"
              aria-checked={chatEmailNotifications}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-4 ${
                chatEmailNotifications ? "bg-foreground" : "bg-foreground/15"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  chatEmailNotifications ? "translate-x-4.5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-body-sm font-medium text-foreground">Auto-send emails</p>
              <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
                When off, drafted emails require confirmation before sending.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoSendEmails((v) => !v)}
              role="switch"
              aria-checked={autoSendEmails}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-4 ${
                autoSendEmails ? "bg-foreground" : "bg-foreground/15"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  autoSendEmails ? "translate-x-4.5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Send delay */}
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Send delay</h3>
        </div>
        <div className="px-5 py-5">
          <div>
            <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
              Email send delay (seconds)
            </label>
            <div className="flex flex-wrap gap-2">
              {delayOptions.map((value) => {
                const selected = emailSendDelay === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEmailSendDelay(value)}
                    className={`rounded-lg border px-3 py-1.5 text-body-sm transition-colors cursor-pointer ${
                      selected
                        ? "border-foreground/20 bg-foreground/[0.03] text-foreground"
                        : "border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15"
                    }`}
                  >
                    {value === 0 ? "Off" : `${value}s`}
                  </button>
                );
              })}
            </div>
            <p className="text-label-sm text-muted-foreground/60 mt-2">
              Undo window before outgoing emails are sent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
