"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { BrokerIdentitySection } from "@/components/settings/broker-identity-section";
import { PolicyDeliverySection } from "@/components/settings/policy-delivery-section";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useClientDetailActions } from "../layout";

type Verification = "strict" | "domain" | "open";

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:opacity-50";

export default function ClientSettingsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const { setActions, setRightPanel } = useClientDetailActions();
  const org = useCachedQuery(
    "orgs.getById.clientSettings",
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const members = useCachedQuery(
    "orgs.listMembersForOrg.clientSettings",
    api.orgs.listMembersForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const updateSettings = useMutation(api.orgs.updateClientEmailSettings);
  const updateCachedOrg = useUpdateCachedQuery<
    Record<string, unknown>,
    { orgId: Id<"organizations"> }
  >("orgs.getById.clientSettings");

  const [verification, setVerification] = useState<Verification>("domain");
  const [emails, setEmails] = useState<string[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!org || hydratedRef.current) return;
    const o = org as {
      allowedEmails?: string[];
      allowedDomains?: string[];
      emailVerification?: Verification;
    };
    setEmails(o.allowedEmails ?? []);
    setDomains(o.allowedDomains ?? []);
    setVerification(o.emailVerification ?? "domain");
    hydratedRef.current = true;
  }, [org]);

  useEffect(() => {
    if (!hydratedRef.current || !clientOrgId) return;
    const handle = setTimeout(() => {
      void updateCachedOrg(
        { orgId: clientOrgId as Id<"organizations"> },
        (current) => ({
          ...current,
          allowedEmails: emails,
          allowedDomains: domains,
          emailVerification: verification,
        }),
      );
      updateSettings({
        clientOrgId: clientOrgId as Id<"organizations">,
        allowedEmails: emails,
        allowedDomains: domains,
        emailVerification: verification,
      }).catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [
    emails,
    domains,
    verification,
    clientOrgId,
    updateCachedOrg,
    updateSettings,
  ]);

  const memberDomains = useMemo(() => {
    const set = new Set<string>();
    for (const m of members ?? []) {
      const d = (m as { email?: string }).email?.split("@")[1]?.toLowerCase();
      if (d) set.add(d);
    }
    return Array.from(set);
  }, [members]);

  const suggestedDomains = useMemo(
    () => memberDomains.filter((d) => !domains.includes(d)),
    [memberDomains, domains],
  );

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

  if (org === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <BrokerIdentitySection orgId={clientOrgId as Id<"organizations">} />

      <PolicyDeliverySection
        clientOrgId={clientOrgId as Id<"organizations">}
        setActions={setActions}
        setRightPanel={setRightPanel}
      />

      <OperationalPanel>
        <OperationalPanelHeader
          title="Email verification"
          description="Choose which inbound senders count as this client when they email your agent handle."
          className="px-6 py-5"
        />

        <OperationalPanelBody className="px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base text-muted-foreground">
              {verification === "strict"
                ? "Only the emails listed below are recognized as this client."
                : verification === "domain"
                  ? "Emails and matching domains below are recognized as this client."
                  : "Any sender with a membership to this client is recognized."}
            </p>
            <Tabs
              value={verification}
              onValueChange={(v) => setVerification(v as Verification)}
            >
              <TabsList variant="pill">
                <TabsTrigger value="strict">Strict</TabsTrigger>
                <TabsTrigger value="domain">Domain</TabsTrigger>
                <TabsTrigger value="open">Open</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </OperationalPanelBody>

        <OperationalPanelBody className="border-t border-foreground/6 px-6 py-5 space-y-4">
          <div>
            <h3 className="text-base font-medium text-foreground">
              Allowed emails
            </h3>
            <p className="mt-1 text-base text-muted-foreground">
              Exact senders that should route to this client.
            </p>
          </div>
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
            onBlur={addEmail}
            placeholder="name@company.com — press Enter to add"
            className={INPUT_CLASSES}
          />
          {emails.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {emails.map((e) => (
                <span
                  key={e}
                  className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover pl-3 pr-1.5 py-1 text-label text-foreground"
                >
                  {e}
                  <button
                    type="button"
                    onClick={() =>
                      setEmails((arr) => arr.filter((x) => x !== e))
                    }
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${e}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </OperationalPanelBody>

        <OperationalPanelBody className="border-t border-foreground/6 px-6 py-5 space-y-4">
          <div>
            <h3 className="text-base font-medium text-foreground">
              Allowed domains
            </h3>
            <p className="mt-1 text-base text-muted-foreground">
              Anyone sending from these domains is recognized as this client.
            </p>
          </div>
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
            onBlur={() => addDomain()}
            placeholder="company.com — press Enter to add"
            disabled={verification === "strict"}
            className={INPUT_CLASSES}
          />
          {domains.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {domains.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover pl-3 pr-1.5 py-1 text-label text-foreground"
                >
                  @{d}
                  <button
                    type="button"
                    onClick={() =>
                      setDomains((arr) => arr.filter((x) => x !== d))
                    }
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${d}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {suggestedDomains.length > 0 && verification !== "strict" ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-label text-muted-foreground/70">
                Suggested from members:
              </span>
              {suggestedDomains.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => addDomain(d)}
                  className="rounded-full border border-dashed border-foreground/15 px-2.5 py-0.5 text-label text-muted-foreground hover:text-foreground hover:border-foreground/30"
                >
                  + @{d}
                </button>
              ))}
            </div>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
