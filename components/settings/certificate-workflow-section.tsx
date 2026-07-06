"use client";

import { useEffect, useRef, useState } from "react";
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
import { useCurrentOrg } from "@/hooks/use-current-org";

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

function signature(value: SettingsDraft) {
  return JSON.stringify({
    renewalReissueEnabled: value.renewalReissueEnabled,
  });
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

  return (
    <CertificateWorkflowEditor
      key={`${result.row?._id ?? "default"}:${result.renewalReissueEnabled}`}
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(signature(initialDraft));
  const editable = isAdmin && (isBroker || isClient);

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
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to save certificate settings",
        );
      }
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, editable, isBroker, updateBrokerDefault, updateClientOverride]);

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Certificates"
          description="Choose whether active certificates should be updated when a renewed policy is uploaded."
          action={(
            <span className="text-label text-muted-foreground">
              {saveStatus === "saving"
                ? "Saving"
                : saveStatus === "error"
                  ? "Not saved"
                  : "Saved"}
            </span>
          )}
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
