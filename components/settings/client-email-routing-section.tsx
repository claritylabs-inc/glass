"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCurrentOrg } from "@/hooks/use-current-org";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { cn } from "@/lib/utils";

type EmailAccessMode = "strict" | "open" | "domain";

type ClientEmailSettings = {
  allowedEmails?: string[];
  allowedDomains?: string[];
  emailVerification?: EmailAccessMode;
};

type ClientMember = {
  email?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const ACCESS_MODES: Array<{
  id: EmailAccessMode;
  label: string;
  description: string;
}> = [
  {
    id: "strict",
    label: "Approved addresses",
    description: "Only the email addresses listed below.",
  },
  {
    id: "open",
    label: "Client team",
    description: "Approved addresses and current client team members.",
  },
  {
    id: "domain",
    label: "Client team and domains",
    description:
      "Approved addresses, client team members, and anyone at an approved domain.",
  },
];

export function ClientEmailRoutingSection({
  clientOrgId,
}: {
  clientOrgId: Id<"organizations">;
}) {
  const currentOrg = useCurrentOrg();
  const canEdit = currentOrg?.isBroker && currentOrg.role === "admin";
  const org = useCachedQuery(
    "orgs.getById.clientEmailRouting",
    api.orgs.getById,
    { orgId: clientOrgId },
  ) as ClientEmailSettings | null | undefined;
  const members = useCachedQuery(
    "orgs.listMembersForOrg.clientEmailRouting",
    api.orgs.listMembersForOrg,
    { orgId: clientOrgId },
  ) as ClientMember[] | undefined;
  const updateSettings = useMutation(api.orgs.updateClientEmailSettings);
  const updateCachedOrg = useUpdateCachedQuery<
    Record<string, unknown>,
    { orgId: Id<"organizations"> }
  >("orgs.getById.clientEmailRouting");

  const [mode, setMode] = useState<EmailAccessMode>("domain");
  const [emails, setEmails] = useState<string[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!org || hydratedRef.current) return;
    setEmails(org.allowedEmails ?? []);
    setDomains(org.allowedDomains ?? []);
    setMode(org.emailVerification ?? "domain");
    hydratedRef.current = true;
    setSettingsHydrated(true);
  }, [org]);

  const autoSave = useLocalFirstAutoSave({
    mutationName: `client.emailRouting.${clientOrgId}`,
    args: {
      clientOrgId,
      allowedEmails: emails,
      allowedDomains: domains,
      emailVerification: mode,
    },
    enabled: settingsHydrated && canEdit,
    delayMs: 400,
    flush: async (args) => {
      await updateSettings(args);
      await updateCachedOrg(
        { orgId: args.clientOrgId },
        (current) => ({
          ...current,
          allowedEmails: args.allowedEmails,
          allowedDomains: args.allowedDomains,
          emailVerification: args.emailVerification,
        }),
      );
    },
    errorMessage: "Inbound email access could not be saved.",
  });

  const memberDomains = useMemo(() => {
    const values = new Set<string>();
    for (const member of members ?? []) {
      const domain = member.email?.split("@")[1]?.toLowerCase();
      if (domain) values.add(domain);
    }
    return Array.from(values);
  }, [members]);

  const suggestedDomains = useMemo(
    () => memberDomains.filter((domain) => !domains.includes(domain)),
    [domains, memberDomains],
  );

  function addEmail() {
    if (!canEdit) return;
    const value = emailInput.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_PATTERN.test(value)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (!emails.includes(value)) setEmails((current) => [...current, value]);
    setEmailInput("");
    setEmailError(null);
  }

  function addDomain(raw?: string) {
    if (!canEdit || mode !== "domain") return;
    const value = (raw ?? domainInput)
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
    if (!value) return;
    if (!DOMAIN_PATTERN.test(value)) {
      setDomainError("Enter a valid domain.");
      return;
    }
    if (!domains.includes(value)) {
      setDomains((current) => [...current, value]);
    }
    setDomainInput("");
    setDomainError(null);
  }

  if (org === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Inbound email access"
        description="Choose who Glass can identify as this client when they email your agent address."
        action={
          canEdit ? (
            <AutoSaveStatus status={autoSave.status} />
          ) : (
            <span className="text-label text-muted-foreground">
              Broker admins can edit
            </span>
          )
        }
        className="px-5 py-4"
      />

      <OperationalPanelBody className="space-y-4 px-5 py-5">
        <div>
          <p className="text-base font-medium text-foreground">
            Recognized senders
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            Messages from recognized senders enter this client&apos;s workspace.
          </p>
        </div>
        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as EmailAccessMode)}
          disabled={!canEdit}
          className="gap-0 overflow-hidden rounded-lg border border-foreground/6"
          aria-label="Recognized senders"
        >
          {ACCESS_MODES.map((option) => (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 border-t border-foreground/6 px-4 py-3 first:border-t-0",
                mode === option.id && "bg-foreground/3",
                !canEdit && "cursor-default",
              )}
            >
              <RadioGroupItem value={option.id} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-base font-medium text-foreground">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-base text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </OperationalPanelBody>

      <OperationalPanelBody className="space-y-4 border-t border-foreground/6 px-5 py-5">
        <div>
          <h3 className="text-base font-medium text-foreground">
            Approved addresses
          </h3>
          <p className="mt-1 text-base text-muted-foreground">
            Add outside contacts or aliases that should enter this client&apos;s
            workspace.
          </p>
        </div>
        <div className="space-y-1.5">
          <Input
            type="email"
            value={emailInput}
            onChange={(event) => {
              setEmailInput(event.target.value);
              setEmailError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addEmail();
              }
            }}
            onBlur={addEmail}
            placeholder="name@company.com"
            disabled={!canEdit}
            aria-invalid={Boolean(emailError)}
          />
          {emailError ? (
            <p className="text-label text-destructive">{emailError}</p>
          ) : null}
        </div>
        {emails.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {emails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover py-1 pr-1.5 pl-3 text-tag text-foreground"
              >
                {email}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEmails((current) =>
                        current.filter((value) => value !== email),
                      )
                    }
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10"
                    aria-label={`Remove ${email}`}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-base text-muted-foreground">
            No additional addresses.
          </p>
        )}
      </OperationalPanelBody>

      {mode !== "strict" ? (
        <OperationalPanelBody className="border-t border-foreground/6 px-5 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div>
              <h3 className="text-base font-medium text-foreground">
                Client team
              </h3>
              <p className="mt-1 text-base text-muted-foreground">
                Current member account emails are included automatically.
              </p>
            </div>
            <p className="shrink-0 text-base text-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
        </OperationalPanelBody>
      ) : null}

      <OperationalPanelBody className="space-y-4 border-t border-foreground/6 px-5 py-5">
        <div>
          <h3 className="text-base font-medium text-foreground">
            Approved domains
          </h3>
          <p className="mt-1 text-base text-muted-foreground">
            {mode === "domain"
              ? "Anyone at these domains is recognized as this client."
              : "Used only when Client team and domains is selected."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Input
            value={domainInput}
            onChange={(event) => {
              setDomainInput(event.target.value);
              setDomainError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDomain();
              }
            }}
            onBlur={() => addDomain()}
            placeholder="company.com"
            disabled={!canEdit || mode !== "domain"}
            aria-invalid={Boolean(domainError)}
          />
          {domainError ? (
            <p className="text-label text-destructive">{domainError}</p>
          ) : null}
        </div>
        {domains.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {domains.map((domain) => (
              <span
                key={domain}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-popover py-1 pr-1.5 pl-3 text-tag text-foreground"
              >
                @{domain}
                {canEdit && mode === "domain" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDomains((current) =>
                        current.filter((value) => value !== domain),
                      )
                    }
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10"
                    aria-label={`Remove ${domain}`}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {mode === "domain" && suggestedDomains.length > 0 && canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-label text-muted-foreground">
              From client members
            </span>
            {suggestedDomains.map((domain) => (
              <button
                key={domain}
                type="button"
                onClick={() => addDomain(domain)}
                className="rounded-full border border-dashed border-foreground/15 px-2.5 py-0.5 text-tag text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10"
              >
                + @{domain}
              </button>
            ))}
          </div>
        ) : null}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
