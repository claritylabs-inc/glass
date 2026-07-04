"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/hooks/use-current-org";

type SettingsSource = "client_override" | "broker_default" | "platform_default";

type SettingsDraft = {
  populateHoldersFromEndorsements: boolean;
  renewalReissueEnabled: boolean;
  policyChangeRequestsForHeldCertificatesEnabled: boolean;
};

type SettingsResult = SettingsDraft & {
  source: SettingsSource;
  row: (Partial<SettingsDraft> & { _id: Id<"certificateWorkflowSettings"> }) | null;
  brokerDefault: (SettingsDraft & { _id: Id<"certificateWorkflowSettings"> }) | null;
  clientOverride: (SettingsDraft & { _id: Id<"certificateWorkflowSettings"> }) | null;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  populateHoldersFromEndorsements: true,
  renewalReissueEnabled: true,
  policyChangeRequestsForHeldCertificatesEnabled: true,
};

function toDraft(value?: Partial<SettingsDraft> | null): SettingsDraft {
  return {
    populateHoldersFromEndorsements:
      value?.populateHoldersFromEndorsements ?? DEFAULT_SETTINGS.populateHoldersFromEndorsements,
    renewalReissueEnabled:
      value?.renewalReissueEnabled ?? DEFAULT_SETTINGS.renewalReissueEnabled,
    policyChangeRequestsForHeldCertificatesEnabled:
      value?.policyChangeRequestsForHeldCertificatesEnabled ??
      DEFAULT_SETTINGS.policyChangeRequestsForHeldCertificatesEnabled,
  };
}

function signature(value: SettingsDraft) {
  return JSON.stringify({
    populateHoldersFromEndorsements: value.populateHoldersFromEndorsements,
    renewalReissueEnabled: value.renewalReissueEnabled,
    policyChangeRequestsForHeldCertificatesEnabled: value.policyChangeRequestsForHeldCertificatesEnabled,
  });
}

function sourceCopy(source: SettingsSource) {
  if (source === "client_override") return "Client override";
  if (source === "broker_default") return "Broker default";
  return "Platform default";
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  label,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="text-base text-muted-foreground">{description}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        onCheckedChange={disabled ? () => null : onToggle}
        label={label}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      />
    </div>
  );
}

export function CertificateWorkflowSection() {
  const result = useQuery(api.certificateWorkflowSettings.getEffectiveForCurrentOrg, {}) as
    | SettingsResult
    | undefined;

  if (!result) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <CertificateWorkflowEditor key={`${result.source}:${result.row?._id ?? "default"}`} result={result} />;
}

function CertificateWorkflowEditor({ result }: { result: SettingsResult }) {
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isClient = currentOrg?.orgType === "client";
  const isAdmin = currentOrg?.role === "admin";
  const updateBrokerDefault = useMutation(api.certificateWorkflowSettings.updateBrokerDefault);
  const updateClientOverride = useMutation(api.certificateWorkflowSettings.updateClientOverride);
  const clearClientOverride = useMutation(api.certificateWorkflowSettings.clearClientOverride);
  const initialDraft = toDraft(result.row ?? result);
  const inheritedDraft = useMemo(
    () => toDraft(result.brokerDefault ?? DEFAULT_SETTINGS),
    [result.brokerDefault],
  );
  const [draft, setDraft] = useState<SettingsDraft>(initialDraft);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(signature(initialDraft));
  const canEdit = isAdmin && (isBroker || isClient);
  const isInheritedClient = isClient && !result.clientOverride;
  const inheritedClientCopy = result.brokerDefault
    ? "This client currently inherits the broker certificate workflow."
    : "This client currently uses the platform certificate workflow defaults.";
  const editable = canEdit && !isInheritedClient;

  useEffect(() => {
    if (!editable) return;
    const nextSignature = signature(draft);
    if (nextSignature === lastSavedRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const payload = { ...draft };
      try {
        if (isBroker) {
          await updateBrokerDefault(payload);
        } else {
          await updateClientOverride(payload);
        }
        lastSavedRef.current = signature(payload);
        setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("error");
        toast.error(error instanceof Error ? error.message : "Failed to save certificate settings");
      }
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, editable, isBroker, updateBrokerDefault, updateClientOverride]);

  async function addOverride() {
    if (!isClient || !canEdit) return;
    const next = toDraft(result.brokerDefault ?? result);
    setDraft(next);
    try {
      await updateClientOverride(next);
      lastSavedRef.current = signature(next);
      toast.success("Certificate override added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add certificate override");
    }
  }

  async function clearOverride() {
    if (!isClient || !canEdit) return;
    try {
      await clearClientOverride({});
      setDraft(inheritedDraft);
      lastSavedRef.current = signature(inheritedDraft);
      toast.success("Certificate override cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear certificate override");
    }
  }

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Certificates"
          description={isBroker
            ? "Defaults for holder records, endorsement handoffs, and renewal review jobs."
            : "Certificate behavior for this client workspace."}
          action={(
            <span className="text-label text-muted-foreground">
              {isInheritedClient ? "Inherited" : saveStatus === "saving" ? "Saving" : saveStatus === "error" ? "Not saved" : "Saved"}
            </span>
          )}
        />
        <OperationalPanelBody className="space-y-0 divide-y divide-foreground/6 py-0">
          <div className="flex flex-wrap items-center gap-2 py-4 text-base text-muted-foreground">
            <span className="rounded-md border border-foreground/8 px-2 py-1 text-label text-foreground">
              {sourceCopy(result.source)}
            </span>
            <span>
              {result.clientOverride
                ? "Client override is active."
                : result.brokerDefault
                  ? "Using broker defaults."
                  : "Using platform defaults."}
            </span>
          </div>
          {isInheritedClient && canEdit ? (
            <div className="flex items-center justify-between gap-4 py-4">
              <p className="text-base text-muted-foreground">
                {inheritedClientCopy}
              </p>
              <PillButton type="button" size="compact" variant="secondary" onClick={() => void addOverride()}>
                Add override
              </PillButton>
            </div>
          ) : null}
          <ToggleRow
            title="Source-backed holder records"
            description="Save certificate holders found in policy endorsements and schedules."
            checked={draft.populateHoldersFromEndorsements}
            disabled={!editable}
            label="Toggle holder population from endorsements"
            onToggle={() => setDraft({
              ...draft,
              populateHoldersFromEndorsements: !draft.populateHoldersFromEndorsements,
            })}
          />
          <ToggleRow
            title="Broker follow-up for endorsement requests"
            description="Draft a broker follow-up instead of issuing when a certificate request needs a policy change."
            checked={draft.policyChangeRequestsForHeldCertificatesEnabled}
            disabled={!editable}
            label="Toggle held COI broker handoff"
            onToggle={() => setDraft({
              ...draft,
              policyChangeRequestsForHeldCertificatesEnabled:
                !draft.policyChangeRequestsForHeldCertificatesEnabled,
            })}
          />
          <ToggleRow
            title="Renewal review queue"
            description="Queue active certificates for review when a renewed policy is uploaded."
            checked={draft.renewalReissueEnabled}
            disabled={!editable}
            label="Toggle renewal review jobs"
            onToggle={() => setDraft({
              ...draft,
              renewalReissueEnabled: !draft.renewalReissueEnabled,
            })}
          />
          {isClient && result.clientOverride ? (
            <div className="flex justify-end py-4">
              <PillButton type="button" variant="secondary" onClick={() => void clearOverride()}>
                Clear client override
              </PillButton>
            </div>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
