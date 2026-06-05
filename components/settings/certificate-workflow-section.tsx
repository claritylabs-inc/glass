"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { Badge } from "@/components/ui/badge";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/hooks/use-current-org";

type SettingsSource = "client_override" | "broker_default" | "platform_default";

type SettingsRow = {
  _id: Id<"certificateWorkflowSettings">;
  sourceBackedHolderPopulationEnabled: boolean;
  renewalReviewJobsEnabled: boolean;
  renewalReviewLeadDays: number;
  policyChangeRequestsForHeldCertificatesEnabled: boolean;
};

type CertificateWorkflowSettingsResult = SettingsDraft & {
  source: SettingsSource;
  row: SettingsRow | null;
  brokerDefault: SettingsRow | null;
  clientOverride: SettingsRow | null;
  clientOrgId: Id<"organizations"> | null;
  brokerOrgId: Id<"organizations"> | null;
};

type SettingsDraft = {
  sourceBackedHolderPopulationEnabled: boolean;
  renewalReviewJobsEnabled: boolean;
  renewalReviewLeadDays: number;
  policyChangeRequestsForHeldCertificatesEnabled: boolean;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  sourceBackedHolderPopulationEnabled: true,
  renewalReviewJobsEnabled: true,
  renewalReviewLeadDays: 60,
  policyChangeRequestsForHeldCertificatesEnabled: true,
};

function settingsSignature(settings: SettingsDraft) {
  return JSON.stringify({
    sourceBackedHolderPopulationEnabled: settings.sourceBackedHolderPopulationEnabled,
    renewalReviewJobsEnabled: settings.renewalReviewJobsEnabled,
    renewalReviewLeadDays: Math.max(0, Math.min(365, Math.round(settings.renewalReviewLeadDays || 0))),
    policyChangeRequestsForHeldCertificatesEnabled:
      settings.policyChangeRequestsForHeldCertificatesEnabled,
  });
}

function toDraft(settings: Partial<SettingsDraft> | null | undefined): SettingsDraft {
  return {
    sourceBackedHolderPopulationEnabled:
      settings?.sourceBackedHolderPopulationEnabled ?? DEFAULT_SETTINGS.sourceBackedHolderPopulationEnabled,
    renewalReviewJobsEnabled:
      settings?.renewalReviewJobsEnabled ?? DEFAULT_SETTINGS.renewalReviewJobsEnabled,
    renewalReviewLeadDays:
      settings?.renewalReviewLeadDays ?? DEFAULT_SETTINGS.renewalReviewLeadDays,
    policyChangeRequestsForHeldCertificatesEnabled:
      settings?.policyChangeRequestsForHeldCertificatesEnabled ??
      DEFAULT_SETTINGS.policyChangeRequestsForHeldCertificatesEnabled,
  };
}

function sourceLabel(source: SettingsSource) {
  if (source === "client_override") return "Client override";
  if (source === "broker_default") return "Broker default";
  return "Platform default";
}

function SourceSummary({ settings }: { settings: CertificateWorkflowSettingsResult }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-base text-muted-foreground">
      <Badge variant={settings.source === "client_override" ? "secondary" : "outline"}>
        {sourceLabel(settings.source)}
      </Badge>
      {settings.clientOverride ? <span>Client override is active.</span> : null}
      {!settings.clientOverride && settings.brokerDefault ? <span>Using broker defaults.</span> : null}
      {!settings.clientOverride && !settings.brokerDefault ? <span>Using Glass platform defaults.</span> : null}
    </div>
  );
}

function SettingSwitchRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
  label,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="text-base text-muted-foreground">{description}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        onCheckedChange={disabled ? () => null : onCheckedChange}
        label={label}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      />
    </div>
  );
}

export function CertificateWorkflowSection() {
  const result = useQuery(api.certificateWorkflowSettings.getEffectiveForCurrentOrg, {}) as
    | CertificateWorkflowSettingsResult
    | undefined;

  if (!result) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <CertificateWorkflowEditor
      key={`${result.source}:${result.row?._id ?? "default"}:${result.clientOverride?._id ?? "none"}:${result.brokerDefault?._id ?? "none"}`}
      result={result}
    />
  );
}

function CertificateWorkflowEditor({ result }: { result: CertificateWorkflowSettingsResult }) {
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isClient = currentOrg?.orgType === "client";
  const isAdmin = currentOrg?.role === "admin";
  const updateBrokerDefault = useMutation(api.certificateWorkflowSettings.updateBrokerDefault);
  const updateClientOverride = useMutation(api.certificateWorkflowSettings.updateClientOverride);
  const clearClientOverride = useMutation(api.certificateWorkflowSettings.clearClientOverride);
  const initialDraft = toDraft(result.row ?? result);
  const [draft, setDraft] = useState<SettingsDraft>(initialDraft);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(settingsSignature(initialDraft));

  const canEdit = isAdmin && (isBroker || isClient);
  const hasClientOverride = !!result?.clientOverride;
  const isInheritedClientSettings = isClient && !hasClientOverride;
  const editable = canEdit && !isInheritedClientSettings;


  const saveSettings = useCallback(async () => {
    if (!canEdit || !result) return;
    setSaveStatus("saving");
    const payload = {
      ...draft,
      renewalReviewLeadDays: Math.max(0, Math.min(365, Math.round(draft.renewalReviewLeadDays || 0))),
    };
    try {
      if (isBroker) {
        await updateBrokerDefault(payload);
      } else {
        await updateClientOverride(payload);
      }
      lastSavedRef.current = settingsSignature(payload);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save certificate settings");
    }
  }, [canEdit, draft, isBroker, result, updateBrokerDefault, updateClientOverride]);

  useEffect(() => {
    if (!editable) return;
    const nextSignature = settingsSignature(draft);
    if (nextSignature === lastSavedRef.current) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveSettings();
    }, 600);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [draft, editable, saveSettings]);

  const inheritedDraft = useMemo(
    () => toDraft(result?.brokerDefault ?? DEFAULT_SETTINGS),
    [result?.brokerDefault],
  );

  async function addOverride() {
    if (!isClient || !canEdit) return;
    const next = toDraft(result?.brokerDefault ?? result ?? DEFAULT_SETTINGS);
    setDraft(next);
    setSaveStatus("saving");
    try {
      await updateClientOverride(next);
      lastSavedRef.current = settingsSignature(next);
      setSaveStatus("saved");
      toast.success("Certificate override added");
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to add override");
    }
  }

  async function clearOverride() {
    if (!isClient || !canEdit) return;
    try {
      await clearClientOverride({});
      setDraft(inheritedDraft);
      lastSavedRef.current = settingsSignature(inheritedDraft);
      setSaveStatus("saved");
      toast.success("Certificate override cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear override");
    }
  }


  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Certificate workflow"
          description={isBroker
            ? "Set broker defaults for certificate evidence, held-request handling, and renewal review jobs."
            : "Review the effective certificate workflow and add client-owned overrides when your team needs a different workflow."}
          className="px-5 py-4"
          action={(
            <span className="text-label text-muted-foreground">
              {isInheritedClientSettings
                ? "Inherited"
                : saveStatus === "saving"
                  ? "Saving"
                  : saveStatus === "error"
                    ? "Not saved"
                    : "Saved"}
            </span>
          )}
        />
        <OperationalPanelBody className="space-y-4 px-5 py-5">
          <SourceSummary settings={result} />
          {isInheritedClientSettings ? (
            <div className="rounded-xl border border-foreground/8 bg-foreground/[0.02] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1 text-base text-muted-foreground">
                  <p className="font-medium text-foreground">Inherited broker workflow</p>
                  <p>
                    Source-backed holder population is {draft.sourceBackedHolderPopulationEnabled ? "on" : "off"};
                    renewal reviews are {draft.renewalReviewJobsEnabled ? `created ${draft.renewalReviewLeadDays} days before renewal` : "off"};
                    held certificate change requests are {draft.policyChangeRequestsForHeldCertificatesEnabled ? "on" : "off"}.
                  </p>
                </div>
                {canEdit ? (
                  <PillButton type="button" size="compact" variant="secondary" onClick={() => void addOverride()}>
                    Add client override
                  </PillButton>
                ) : null}
              </div>
            </div>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Holder population" className="px-5 py-3.5" />
        <OperationalPanelBody className="divide-y divide-foreground/6 px-5 py-2">
          <SettingSwitchRow
            title="Source-backed holder population"
            description="Only populate certificate holders from endorsed or policy-specific source evidence that Glass can cite."
            checked={draft.sourceBackedHolderPopulationEnabled}
            disabled={!editable}
            onCheckedChange={() => setDraft({
              ...draft,
              sourceBackedHolderPopulationEnabled: !draft.sourceBackedHolderPopulationEnabled,
            })}
            label="Toggle source-backed holder population"
          />
          <SettingSwitchRow
            title="Held certificate policy changes"
            description="When a certificate request needs an endorsement, open a linked policy change case instead of only offering broker handoff."
            checked={draft.policyChangeRequestsForHeldCertificatesEnabled}
            disabled={!editable}
            onCheckedChange={() => setDraft({
              ...draft,
              policyChangeRequestsForHeldCertificatesEnabled:
                !draft.policyChangeRequestsForHeldCertificatesEnabled,
            })}
            label="Toggle certificate policy change requests"
          />
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Renewal review jobs" className="px-5 py-3.5" />
        <OperationalPanelBody className="space-y-5 px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-base font-medium text-foreground">Create renewal review jobs</p>
              <p className="text-base text-muted-foreground">
                Queue draft/review certificate work for active issued certificates when a policy approaches renewal.
              </p>
            </div>
            <SettingsSwitch
              checked={draft.renewalReviewJobsEnabled}
              onCheckedChange={editable ? () => setDraft({
                ...draft,
                renewalReviewJobsEnabled: !draft.renewalReviewJobsEnabled,
              }) : () => null}
              label="Toggle renewal review jobs"
              className={!editable ? "pointer-events-none opacity-50" : undefined}
            />
          </div>
          <label className="block max-w-xs space-y-2">
            <span className="text-label text-muted-foreground">Review lead time (days)</span>
            <input
              type="number"
              min={0}
              max={365}
              disabled={!editable || !draft.renewalReviewJobsEnabled}
              value={draft.renewalReviewLeadDays}
              onChange={(event) => setDraft({
                ...draft,
                renewalReviewLeadDays: Number(event.target.value) || 0,
              })}
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none transition-colors focus:border-foreground/20 disabled:opacity-50"
            />
          </label>
          {isClient && hasClientOverride ? (
            <div className="flex justify-end">
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
