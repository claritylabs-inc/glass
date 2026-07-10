"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { Badge } from "@/components/ui/badge";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useCurrentOrg } from "@/hooks/use-current-org";

type Channel = "email" | "imessage";
type DeliveryAction = "auto_send" | "broker_review" | "do_not_send";
type SettingsRow = {
  _id?: Id<"policyDeliverySettings">;
  updatedAt?: number;
  enabled: boolean;
  channels: Channel[];
  defaultAction: DeliveryAction;
  deliverBeforeClientAcceptance: boolean;
  copyInstructions?: string;
};
type RuleRow = {
  _id: Id<"policyDeliveryRules">;
  name: string;
  enabled: boolean;
  priority: number;
  filters?: Record<string, string[] | undefined>;
  llmRuleText?: string;
  action: DeliveryAction;
  channels?: Channel[];
  copyInstructions?: string;
};
type ClientSettingsResult = {
  override: SettingsRow | null;
  brokerSettings: SettingsRow | null;
};

const DEFAULT_SETTINGS: SettingsRow = {
  enabled: false,
  channels: ["email"],
  defaultAction: "broker_review",
  deliverBeforeClientAcceptance: false,
  copyInstructions: "",
};

const ACTION_LABELS: Record<DeliveryAction, string> = {
  auto_send: "Auto-send",
  broker_review: "Broker review",
  do_not_send: "Do not send",
};

function channelsLabel(channels: Channel[] | undefined) {
  if (!channels?.length) return "Inherit";
  if (channels.length === 2) return "Email + iMessage";
  return channels[0] === "email" ? "Email" : "iMessage";
}

function onOffLabel(enabled: boolean) {
  return enabled ? "On" : "Off";
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDraftSettings(settings: SettingsRow | null | undefined): SettingsRow {
  return {
    enabled: settings?.enabled ?? DEFAULT_SETTINGS.enabled,
    channels: settings?.channels ?? DEFAULT_SETTINGS.channels,
    defaultAction: settings?.defaultAction ?? DEFAULT_SETTINGS.defaultAction,
    deliverBeforeClientAcceptance:
      settings?.deliverBeforeClientAcceptance ?? DEFAULT_SETTINGS.deliverBeforeClientAcceptance,
    copyInstructions: settings?.copyInstructions ?? DEFAULT_SETTINGS.copyInstructions,
  };
}

function uniqueList(values: Array<string | undefined>) {
  return [...new Set(values.flatMap((value) => parseList(value ?? "")))];
}

function settingsSignature(settings: SettingsRow) {
  return JSON.stringify({
    enabled: settings.enabled,
    channels: [...settings.channels].sort(),
    defaultAction: settings.defaultAction,
    deliverBeforeClientAcceptance: settings.deliverBeforeClientAcceptance,
    copyInstructions: settings.copyInstructions ?? "",
  });
}

function ChannelToggles({
  value,
  onChange,
}: {
  value: Channel[];
  onChange: (value: Channel[]) => void;
}) {
  function toggle(channel: Channel) {
    const next = value.includes(channel)
      ? value.filter((item) => item !== channel)
      : [...value, channel];
    onChange(next.length > 0 ? next : [channel]);
  }
  return (
    <div className="flex gap-2">
      {(["email", "imessage"] as Channel[]).map((channel) => (
        <button
          key={channel}
          type="button"
          onClick={() => toggle(channel)}
          className={`h-8 rounded-lg border px-3 text-base transition-colors ${
            value.includes(channel)
              ? "border-foreground/20 bg-foreground/8 text-foreground"
              : "border-foreground/8 text-muted-foreground hover:bg-foreground/4"
          }`}
        >
          {channel === "email" ? "Email" : "iMessage"}
        </button>
      ))}
    </div>
  );
}

function ActionSelect({
  value,
  onChange,
}: {
  value: DeliveryAction;
  onChange: (value: DeliveryAction) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange((next ?? "broker_review") as DeliveryAction)}>
      <SelectTrigger className="w-44">
        <SelectValue>{ACTION_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto_send">Auto-send</SelectItem>
        <SelectItem value="broker_review">Broker review</SelectItem>
        <SelectItem value="do_not_send">Do not send</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RuleDrawer({
  open,
  onOpenChange,
  clientOrgId,
  rule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientOrgId?: Id<"organizations">;
  rule?: RuleRow | null;
}) {
  const upsertRule = useMutation(api.policyDelivery.upsertRule);
  const [name, setName] = useState(rule?.name ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [action, setAction] = useState<DeliveryAction>(rule?.action ?? "auto_send");
  const [channels, setChannels] = useState<Channel[]>(rule?.channels ?? []);
  const [insurers, setInsurers] = useState(
    uniqueList([
      rule?.filters?.carriers?.join(", "),
      rule?.filters?.securities?.join(", "),
    ]).join(", "),
  );
  const [lines, setLines] = useState(
    uniqueList([
      rule?.filters?.linesOfBusiness?.join(", "),
    ]).join(", "),
  );
  const [llmRuleText, setLlmRuleText] = useState(rule?.llmRuleText ?? "");
  const [copyInstructions, setCopyInstructions] = useState(rule?.copyInstructions ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertRule({
        id: rule?._id,
        clientOrgId,
        name,
        enabled,
        priority,
        action,
        channels: channels.length > 0 ? channels : undefined,
        filters: {
          carriers: parseList(insurers),
          linesOfBusiness: parseList(lines),
        },
        llmRuleText: llmRuleText || undefined,
        copyInstructions: copyInstructions || undefined,
      });
      toast.success("Delivery rule saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? "Edit delivery rule" : "New delivery rule"}
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </PillButton>
          <PillButton type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save rule
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <label className="space-y-1.5">
          <span className="text-label text-muted-foreground">Name</span>
          <input className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={name} onChange={(event) => setName(event.target.value)} placeholder="Cyber renewals from Coalition" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-label text-muted-foreground">Priority</span>
            <input type="number" className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={priority} onChange={(event) => setPriority(Number(event.target.value) || 100)} placeholder="100" />
          </label>
          <div className="space-y-1.5">
            <span className="text-label text-muted-foreground">Enabled</span>
            <div className="flex h-9 items-center">
              <SettingsSwitch checked={enabled} onCheckedChange={() => setEnabled(!enabled)} label="Rule enabled" />
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="text-label text-muted-foreground">Action</span>
          <ActionSelect value={action} onChange={setAction} />
        </div>
        <div className="space-y-1.5">
          <span className="text-label text-muted-foreground">Channel override</span>
          <ChannelToggles value={channels} onChange={setChannels} />
        </div>
        <label className="space-y-1.5">
          <span className="text-label text-muted-foreground">Insurers or markets</span>
          <input className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={insurers} onChange={(event) => setInsurers(event.target.value)} placeholder="Coalition, CNA, Lloyd's" />
        </label>
        <label className="space-y-1.5">
          <span className="text-label text-muted-foreground">Lines of business</span>
          <input className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={lines} onChange={(event) => setLines(event.target.value)} placeholder="General liability, Workers comp, Flood" />
        </label>
        <label className="space-y-1.5">
          <span className="text-label text-muted-foreground">LLM rule</span>
          <textarea className="min-h-24 w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={llmRuleText} onChange={(event) => setLlmRuleText(event.target.value)} placeholder="Only auto-send if the policy is a renewal and the named insured matches the client legal name." />
        </label>
        <label className="space-y-1.5">
          <span className="text-label text-muted-foreground">Copy instructions</span>
          <textarea className="min-h-24 w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20" value={copyInstructions} onChange={(event) => setCopyInstructions(event.target.value)} placeholder="Mention that this replaces the expiring policy and ask the client to reply with any questions." />
        </label>
      </div>
    </SettingsDrawer>
  );
}

export function PolicyDeliverySection({
  clientOrgId,
  setRightPanel: setRightPanelOverride,
  setActions: setActionsOverride,
}: {
  clientOrgId?: Id<"organizations">;
  setRightPanel?: (node: ReactNode) => void;
  setActions?: (node: ReactNode) => void;
}) {
  const currentOrg = useCurrentOrg();
  const brokerSettings = useQuery(
    api.policyDelivery.getBrokerSettings,
    clientOrgId ? "skip" : {},
  ) as SettingsRow | null | undefined;
  const clientSettings = useQuery(
    api.policyDelivery.getClientSettings,
    clientOrgId ? { clientOrgId } : "skip",
  ) as ClientSettingsResult | undefined;
  const rules = useQuery(api.policyDelivery.listRules, clientOrgId ? { clientOrgId } : {}) as RuleRow[] | undefined;

  const clientOverride = clientOrgId ? (clientSettings?.override ?? null) : null;
  const inheritedSettings = clientOrgId ? (clientSettings?.brokerSettings ?? null) : null;
  const settings = clientOrgId ? clientOverride : brokerSettings;

  if ((clientOrgId ? clientSettings === undefined : brokerSettings === undefined) || rules === undefined) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const draftKey = `${clientOrgId ?? currentOrg?.orgId ?? "broker"}:${
    clientOrgId ? (clientOverride ? "override" : "inherited") : "direct"
  }`;

  return (
    <PolicyDeliveryEditor
      key={draftKey}
      clientOrgId={clientOrgId}
      settings={toDraftSettings(settings ?? inheritedSettings)}
      hasClientOverride={!clientOrgId || !!clientOverride}
      rules={rules}
      setRightPanelOverride={setRightPanelOverride}
      setActionsOverride={setActionsOverride}
    />
  );
}

function PolicyDeliveryEditor({
  clientOrgId,
  settings,
  hasClientOverride,
  rules,
  setRightPanelOverride,
  setActionsOverride,
}: {
  clientOrgId?: Id<"organizations">;
  settings: SettingsRow;
  hasClientOverride: boolean;
  rules: RuleRow[];
  setRightPanelOverride?: (node: ReactNode) => void;
  setActionsOverride?: (node: ReactNode) => void;
}) {
  const {
    setActions: setSettingsActions,
    setRightPanel: setSettingsRightPanel,
  } = useSettingsActions();
  const setActions = setActionsOverride ?? setSettingsActions;
  const setRightPanel = setRightPanelOverride ?? setSettingsRightPanel;
  const updateBrokerSettings = useMutation(api.policyDelivery.updateBrokerSettings);
  const updateClientOverride = useMutation(api.policyDelivery.updateClientOverride);
  const clearOverride = useMutation(api.policyDelivery.clearClientOverride);
  const deleteRule = useMutation(api.policyDelivery.deleteRule);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null);
  const [draft, setDraft] = useState<SettingsRow>(settings);
  const [copyInstructionsFocused, setCopyInstructionsFocused] = useState(false);
  const isInheritedClientSettings = !!clientOrgId && !hasClientOverride;

  const settingsAutoSave = useLocalFirstAutoSave({
    mutationName: `settings.policyDelivery.${clientOrgId ?? "broker"}`,
    args: draft,
    valueKey: settingsSignature(draft),
    enabled: !isInheritedClientSettings,
    autoSave: !copyInstructionsFocused,
    flush: (args) =>
      clientOrgId
        ? updateClientOverride({ clientOrgId, ...args })
        : updateBrokerSettings(args),
    errorMessage: "Policy delivery settings could not be saved.",
  });

  useEffect(() => {
    setRightPanel(
      <RuleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        clientOrgId={clientOrgId}
        rule={editingRule}
      />,
    );
    return () => setRightPanel(null);
  }, [clientOrgId, drawerOpen, editingRule, setRightPanel]);

  useEffect(() => {
    setActions(
      <PillButton
        type="button"
        size="compact"
        variant="secondary"
        onClick={() => {
          setEditingRule(null);
          setDrawerOpen(true);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        New rule
      </PillButton>,
    );
    return () => setActions(null);
  }, [setActions]);

  async function resetOverride() {
    if (!clientOrgId) return;
    await settingsAutoSave.saveNow();
    await clearOverride({ clientOrgId });
    toast.success("Client override cleared");
  }

  async function addOverride() {
    if (!clientOrgId) return;
    try {
      await updateClientOverride({
        clientOrgId,
        enabled: draft.enabled,
        channels: draft.channels,
        defaultAction: draft.defaultAction,
        deliverBeforeClientAcceptance: draft.deliverBeforeClientAcceptance,
        copyInstructions: draft.copyInstructions,
      });
      toast.success("Client override added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add override");
    }
  }

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Policy delivery"
          className="px-5 py-3.5"
          action={(
            isInheritedClientSettings ? (
              <span className="text-label text-muted-foreground">Inherited</span>
            ) : (
              <AutoSaveStatus status={settingsAutoSave.status} />
            )
          )}
        />
        {isInheritedClientSettings ? (
          <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-base">
              <Badge variant={draft.enabled ? "secondary" : "outline"}>
                Delivery {onOffLabel(draft.enabled)}
              </Badge>
              <span className="text-muted-foreground">{channelsLabel(draft.channels)}</span>
              <span className="text-muted-foreground">{ACTION_LABELS[draft.defaultAction]}</span>
              <span className="text-muted-foreground">
                Pre-invite {onOffLabel(draft.deliverBeforeClientAcceptance)}
              </span>
            </div>
            <PillButton
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => void addOverride()}
            >
              Add override
            </PillButton>
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-medium text-foreground">Enable delivery automation</p>
                <p className="text-base text-muted-foreground">Deliver bound policy documents and endorsements after processing.</p>
              </div>
              <SettingsSwitch checked={draft.enabled} onCheckedChange={() => setDraft({ ...draft, enabled: !draft.enabled })} label="Enable policy delivery" />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-label text-muted-foreground">Channels</p>
                <ChannelToggles value={draft.channels} onChange={(channels) => setDraft({ ...draft, channels })} />
              </div>
              <div className="space-y-2">
                <p className="text-label text-muted-foreground">Default action</p>
                <ActionSelect value={draft.defaultAction} onChange={(defaultAction) => setDraft({ ...draft, defaultAction })} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-medium text-foreground">Deliver before invite acceptance</p>
                <p className="text-base text-muted-foreground">Use captured primary contact details before the client logs in.</p>
              </div>
              <SettingsSwitch checked={draft.deliverBeforeClientAcceptance} onCheckedChange={() => setDraft({ ...draft, deliverBeforeClientAcceptance: !draft.deliverBeforeClientAcceptance })} label="Deliver before invite acceptance" />
            </div>
            <label className="block space-y-2">
              <span className="text-label text-muted-foreground">Broker copy instructions</span>
              <textarea
                value={draft.copyInstructions ?? ""}
                onChange={(event) => setDraft({ ...draft, copyInstructions: event.target.value })}
                onFocus={() => setCopyInstructionsFocused(true)}
                onBlur={() => {
                  setCopyInstructionsFocused(false);
                  void settingsAutoSave.saveNow();
                }}
                className="min-h-24 w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base outline-none focus:border-foreground/20"
                placeholder="Use our standard policy delivery language. Mention claims contact details when available."
              />
            </label>
            <div className="flex justify-end gap-2">
              {clientOrgId ? (
                <PillButton type="button" variant="secondary" onClick={resetOverride}>
                  Clear override
                </PillButton>
              ) : null}
            </div>
          </div>
        )}
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Conditional rules" className="px-5 py-3.5" />
        {rules.length === 0 ? (
          <div className="px-5 py-8 text-base text-muted-foreground">No rules yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4 text-label text-muted-foreground">Rule</TableHead>
                <TableHead className="text-label text-muted-foreground">Action</TableHead>
                <TableHead className="text-label text-muted-foreground">Channels</TableHead>
                <TableHead className="text-label text-muted-foreground">Priority</TableHead>
                <TableHead className="px-4 text-right text-label text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow
                  key={rule._id}
                  className="cursor-pointer"
                  onClick={() => {
                    setEditingRule(rule);
                    setDrawerOpen(true);
                  }}
                >
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{rule.name}</span>
                      <Badge variant={rule.enabled ? "secondary" : "outline"}>{rule.enabled ? "On" : "Off"}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{ACTION_LABELS[rule.action]}</TableCell>
                  <TableCell className="text-muted-foreground">{channelsLabel(rule.channels)}</TableCell>
                  <TableCell className="text-muted-foreground">{rule.priority}</TableCell>
                  <TableCell className="px-4 text-right">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteRule({ id: rule._id });
                      }}
                      aria-label="Delete rule"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </OperationalPanel>

    </div>
  );
}
