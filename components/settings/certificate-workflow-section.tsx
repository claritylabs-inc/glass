"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

type SettingsDraft = {
  renewalReissueEnabled: boolean;
};

type SettingsResult = SettingsDraft & {
  row:
    | (Partial<SettingsDraft> & { _id: Id<"certificateWorkflowSettings"> })
    | null;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  renewalReissueEnabled: true,
};

function toDraft(value?: Partial<SettingsDraft> | null): SettingsDraft {
  return {
    renewalReissueEnabled:
      value?.renewalReissueEnabled ?? DEFAULT_SETTINGS.renewalReissueEnabled,
  };
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
  const currentOrg = useCurrentOrg();
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

  return (
    <CertificateWorkflowEditor
      key={currentOrg?.orgId ?? "none"}
      result={result}
    />
  );
}

function CertificateWorkflowEditor({ result }: { result: SettingsResult }) {
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isClient = currentOrg?.orgType === "client";
  const isAdmin = currentOrg?.role === "admin";
  const updateBrokerDefault = useMutation(
    api.certificateWorkflowSettings.updateBrokerDefault,
  );
  const updateClientOverride = useMutation(
    api.certificateWorkflowSettings.updateClientOverride,
  );
  const initialDraft = toDraft(result.row ?? result);
  const [draft, setDraft] = useState<SettingsDraft>(initialDraft);
  const editable = isAdmin && (isBroker || isClient);

  const autoSave = useLocalFirstAutoSave({
    mutationName: "settings.certificates.updateWorkflow",
    args: draft,
    enabled: editable,
    flush: (args) =>
      isBroker ? updateBrokerDefault(args) : updateClientOverride(args),
    errorMessage: "Certificate settings could not be saved.",
  });

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Certificates"
          description="Choose whether active certificates should be updated when a renewed policy is uploaded."
          action={editable ? <AutoSaveStatus status={autoSave.status} /> : undefined}
        />
        <OperationalPanelBody className="space-y-0 divide-y divide-foreground/6 py-0">
          <ToggleRow
            title="Update certificates on renewal"
            description="When a renewed policy is uploaded, Glass reviews active certificates and prepares updated versions."
            checked={draft.renewalReissueEnabled}
            disabled={!editable}
            label="Toggle certificate updates on renewal"
            onToggle={() =>
              setDraft({
                ...draft,
                renewalReissueEnabled: !draft.renewalReissueEnabled,
              })
            }
          />
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
