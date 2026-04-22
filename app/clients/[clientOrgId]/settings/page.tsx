"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

type Verification = "strict" | "domain" | "open";

export default function ClientSettingsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const org = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const members = useQuery(
    api.orgs.listMembersForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const updateSettings = useMutation(api.orgs.updateClientEmailSettings);

  const [verification, setVerification] = useState<Verification>("domain");
  const [emails, setEmails] = useState<string[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!org) return;
    const o = org as {
      allowedEmails?: string[];
      allowedDomains?: string[];
      emailVerification?: Verification;
    };
    setEmails(o.allowedEmails ?? []);
    setDomains(o.allowedDomains ?? []);
    setVerification(o.emailVerification ?? "domain");
  }, [org]);

  const memberDomains = useMemo(() => {
    const set = new Set<string>();
    for (const m of members ?? []) {
      const d = (m as { email?: string }).email?.split("@")[1]?.toLowerCase();
      if (d) set.add(d);
    }
    return Array.from(set);
  }, [members]);

  function addEmail() {
    const v = emailInput.trim().toLowerCase();
    if (!v || !v.includes("@") || emails.includes(v)) {
      setEmailInput("");
      return;
    }
    setEmails((arr) => [...arr, v]);
    setEmailInput("");
  }
  function addDomain(raw?: string) {
    const v = (raw ?? domainInput).trim().toLowerCase().replace(/^@/, "");
    if (!v || domains.includes(v)) {
      setDomainInput("");
      return;
    }
    setDomains((arr) => [...arr, v]);
    setDomainInput("");
  }

  async function handleSave() {
    if (!clientOrgId) return;
    setSaving(true);
    try {
      await updateSettings({
        clientOrgId: clientOrgId as Id<"organizations">,
        allowedEmails: emails,
        allowedDomains: domains,
        emailVerification: verification,
      });
      toast.success("Client email settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (org === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Email verification</h3>
          <p className="text-label-sm text-muted-foreground mt-1">
            Choose which inbound senders count as this client when they email your agent handle.
          </p>
        </div>
        <div className="px-5 py-5 space-y-5">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-foreground/8 bg-popover p-1">
            {(
              [
                { v: "strict" as const, label: "Strict", desc: "Only allowed emails" },
                { v: "domain" as const, label: "Domain", desc: "Allowed emails + domains" },
                { v: "open" as const, label: "Open", desc: "Any sender routed via membership" },
              ]
            ).map(({ v, label, desc }) => (
              <button
                key={v}
                type="button"
                onClick={() => setVerification(v)}
                className={`rounded-md px-3 py-2 text-left transition-colors ${
                  verification === v
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="text-label-sm font-medium">{label}</div>
                <div
                  className={`text-[11px] ${
                    verification === v ? "text-background/70" : "text-muted-foreground/70"
                  }`}
                >
                  {desc}
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-label-sm font-medium text-muted-foreground block">
              Allowed emails
            </label>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                placeholder="adyan@cove.dev"
                className="flex-1 rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
              <PillButton
                type="button"
                variant="secondary"
                onClick={addEmail}
                disabled={!emailInput.trim()}
              >
                Add
              </PillButton>
            </div>
            {emails.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {emails.map((e) => (
                  <span
                    key={e}
                    className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover pl-3 pr-1.5 py-1 text-label-sm text-foreground"
                  >
                    {e}
                    <button
                      type="button"
                      onClick={() => setEmails((arr) => arr.filter((x) => x !== e))}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${e}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-label-sm font-medium text-muted-foreground block">
              Allowed domains
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDomain();
                  }
                }}
                placeholder="cove.dev"
                disabled={verification === "strict"}
                className="flex-1 rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:opacity-50"
              />
              <PillButton
                type="button"
                variant="secondary"
                onClick={() => addDomain()}
                disabled={verification === "strict" || !domainInput.trim()}
              >
                Add
              </PillButton>
            </div>
            {domains.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {domains.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover pl-3 pr-1.5 py-1 text-label-sm text-foreground"
                  >
                    @{d}
                    <button
                      type="button"
                      onClick={() => setDomains((arr) => arr.filter((x) => x !== d))}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${d}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {memberDomains.length > 0 && verification !== "strict" ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-label-sm text-muted-foreground/70">
                  Suggested from members:
                </span>
                {memberDomains
                  .filter((d) => !domains.includes(d))
                  .map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => addDomain(d)}
                      className="rounded-full border border-dashed border-foreground/15 px-2.5 py-0.5 text-label-sm text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    >
                      + @{d}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <PillButton type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Saving…" : "Save settings"}
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}
