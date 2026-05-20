"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Loader2,
  Mail,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import { useQuery } from "convex/react";
import { AppShell } from "@/components/app-shell";
import {
  BrokerIdentitySection,
  type BrokerIdentity,
} from "@/components/settings/broker-identity-section";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";

type DetailItemProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  href?: string;
};

function DetailItem({ icon: Icon, label, value, href }: DetailItemProps) {
  const displayValue = value?.trim() || "Not set";
  const muted = !value?.trim();

  return (
    <div className="flex min-w-0 gap-3 border-b border-foreground/6 py-5 pr-6">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-label-sm font-medium text-muted-foreground">
          {label}
        </div>
        {href && !muted ? (
          <a
            href={href}
            className="mt-1 block truncate text-body-sm text-foreground underline-offset-4 hover:underline"
          >
            {displayValue}
          </a>
        ) : (
          <div
            className={`mt-1 truncate text-body-sm ${
              muted ? "text-muted-foreground/60" : "text-foreground"
            }`}
          >
            {displayValue}
          </div>
        )}
      </div>
    </div>
  );
}

function relationshipLabel(identity: BrokerIdentity) {
  if (identity.connected) return "Connected broker";
  if (identity.source === "manual") return "Broker contact";
  return "No broker contact";
}

export default function BrokerPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const [editOpen, setEditOpen] = useState(false);
  const brokerPageContext = useQuery(api.orgs.getBrokerPageContext, {});
  const identity = useQuery(
    api.orgs.getBrokerIdentity,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as BrokerIdentity | null | undefined;

  useEffect(() => {
    if (brokerPageContext && !brokerPageContext.showBrokerPage) {
      router.replace("/policies");
    }
  }, [brokerPageContext, router]);

  const canEdit = !!(identity?.canEditManual || identity?.canEditConnected);
  const brokerName = identity?.brokerCompanyName?.trim();
  const contactName = identity?.contactName?.trim();
  const contactEmail = identity?.contactEmail?.trim();
  const contactPhone = identity?.contactPhone?.trim();
  const hasBrokerInfo = !!(
    brokerName ||
    contactName ||
    contactEmail ||
    contactPhone
  );
  const summary = useMemo(() => {
    if (!identity) return "";
    if (!hasBrokerInfo) {
      return canEdit
        ? "Add the broker contact your team should use for insurance support."
        : "Your broker contact has not been added yet.";
    }
    const pieces = [contactName, contactEmail, contactPhone].filter(Boolean);
    return pieces.length > 0
      ? pieces.join(" · ")
      : "Your insurance broker contact.";
  }, [canEdit, contactEmail, contactName, contactPhone, hasBrokerInfo, identity]);

  if (!currentOrg?.orgId || !brokerPageContext?.showBrokerPage) return null;

  const actions = canEdit ? (
    <PillButton
      variant="secondary"
      size="compact"
      onClick={() => setEditOpen(true)}
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit
    </PillButton>
  ) : null;

  return (
    <AppShell
      actions={actions}
      rightPanel={
        <SettingsDrawer
          open={editOpen}
          onOpenChange={setEditOpen}
          title="Edit broker contact"
        >
          <BrokerIdentitySection orgId={currentOrg.orgId} surface="plain" />
        </SettingsDrawer>
      }
    >
      {identity === undefined ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="w-full max-w-6xl space-y-8">
          <section className="border-b border-foreground/6 pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center rounded-full bg-foreground/[0.04] px-2.5 py-1 text-label-sm font-medium text-muted-foreground">
                  {identity ? relationshipLabel(identity) : "Broker"}
                </div>
                <h1 className="mb-0! truncate text-2xl font-medium tracking-normal text-foreground">
                  {brokerName || "No broker contact set"}
                </h1>
                <p className="mt-2 max-w-2xl text-body-sm text-muted-foreground">
                  {summary}
                </p>
              </div>
              {canEdit ? (
                <PillButton
                  variant="secondary"
                  size="compact"
                  className="sm:hidden"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </PillButton>
              ) : null}
            </div>
          </section>

          <section
            className="grid border-t border-foreground/6 md:grid-cols-2"
            aria-label="Broker contact details"
          >
            <DetailItem
              icon={Building2}
              label="Broker company"
              value={brokerName}
            />
            <DetailItem
              icon={UserRound}
              label="Primary contact"
              value={contactName}
            />
            <DetailItem
              icon={Mail}
              label="Email"
              value={contactEmail}
              href={contactEmail ? `mailto:${contactEmail}` : undefined}
            />
            <DetailItem
              icon={Phone}
              label="Phone"
              value={contactPhone}
              href={contactPhone ? `tel:${contactPhone}` : undefined}
            />
          </section>

          {!hasBrokerInfo && canEdit ? (
            <div className="border-t border-foreground/6 pt-5">
              <PillButton
                variant="primary"
                size="compact"
                onClick={() => setEditOpen(true)}
              >
                Add broker contact
              </PillButton>
            </div>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
