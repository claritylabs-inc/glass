"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BrokerAgentTab() {
  const currentOrg = useCurrentOrg();
  const updateOrg = useMutation(api.orgs.updateOrg);

  const org = currentOrg?.org;

  const [chatEmailNotifications, setChatEmailNotifications] = useState(
    (org as { chatEmailNotifications?: boolean } | undefined)?.chatEmailNotifications ?? false,
  );
  const [autoSendEmails, setAutoSendEmails] = useState(
    (org as { autoSendEmails?: boolean } | undefined)?.autoSendEmails ?? false,
  );
  const [emailSendDelay, setEmailSendDelay] = useState(
    String((org as { emailSendDelay?: number } | undefined)?.emailSendDelay ?? 5),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateOrg({
        chatEmailNotifications,
        autoSendEmails,
        emailSendDelay: Number(emailSendDelay),
      });
      toast.success("Agent settings saved");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-lg font-semibold">Agent</h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Email notifications for chat responses</Label>
            <p className="text-xs text-muted-foreground">
              Send email notifications when the agent replies in email threads.
            </p>
          </div>
          <input
            type="checkbox"
            checked={chatEmailNotifications}
            onChange={(e) => setChatEmailNotifications(e.target.checked)}
            className="w-4 h-4"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Auto-send emails</Label>
            <p className="text-xs text-muted-foreground">
              When off, drafted emails require confirmation before sending.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoSendEmails}
            onChange={(e) => setAutoSendEmails(e.target.checked)}
            className="w-4 h-4"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="emailSendDelay">
            Email send delay (seconds)
          </Label>
          <Input
            id="emailSendDelay"
            type="number"
            min="0"
            value={emailSendDelay}
            onChange={(e) => setEmailSendDelay(e.target.value)}
            className="w-24"
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save agent settings"}
        </Button>
      </div>
    </div>
  );
}
