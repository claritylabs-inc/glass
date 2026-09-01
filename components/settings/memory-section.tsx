"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Label } from "@/components/ui/label";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type MemoryItem = {
  _id: Id<"orgMemory">;
  type: string;
  content: string;
  source: string;
  updatedAt: number;
};

const TYPE_LABELS: Record<string, string> = {
  fact: "Facts",
  preference: "Preferences",
  risk_note: "Risk notes",
  observation: "Observations",
};

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat",
  email: "Email",
  imessage: "iMessage",
  extraction: "Extraction",
  analysis: "Analysis",
  slack: "Slack",
  manual: "Manual",
  operator: "Operator",
  mcp: "MCP",
};

const MEMORY_TYPE_ORDER = ["fact", "preference", "risk_note", "observation"];

function errorMessage(error: unknown, fallback: string) {
  return getUserFacingErrorMessage(error, fallback);
}

function MemoryDrawer({
  memory,
  onClose,
  onSave,
  onDelete,
}: {
  memory?: MemoryItem;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(memory?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const normalizedDraft = draft.trim().replace(/\s+/g, " ");
  const canSave =
    Boolean(normalizedDraft) && normalizedDraft !== memory?.content && !saving;

  async function save() {
    if (!normalizedDraft) return;
    setSaving(true);
    try {
      await onSave(normalizedDraft);
      toast.success(memory ? "Memory updated" : "Memory created");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save memory"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      toast.success("Memory deleted");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete memory"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving && !deleting) onClose();
      }}
      title={memory ? "Edit memory" : "New company memory"}
      footer={
        confirmDelete ? (
          <>
            <PillButton
              variant="secondary"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              Keep memory
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {deleting ? "Deleting…" : "Delete memory"}
            </PillButton>
          </>
        ) : (
          <>
            {memory && onDelete ? (
              <PillButton
                variant="destructive"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </PillButton>
            ) : (
              <PillButton variant="secondary" onClick={onClose}>
                Cancel
              </PillButton>
            )}
            <PillButton disabled={!canSave} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : memory ? "Save changes" : "Create memory"}
            </PillButton>
          </>
        )
      }
    >
      {confirmDelete ? (
        <OperationalPanel
          as="div"
          className="border-destructive/20 bg-destructive/5 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Delete this company memory?
              </p>
              <p
                className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
              >
                Spot will stop using it in future advice and servicing.
              </p>
            </div>
          </div>
        </OperationalPanel>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`memory-${memory?._id ?? "new"}`}>
              Stable company fact
            </Label>
            <Textarea
              id={`memory-${memory?._id ?? "new"}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-28 resize-y"
              maxLength={280}
              placeholder="Cove is incorporated in Delaware."
              autoFocus
            />
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Save durable company context only. Policy terms, certificate work,
              and one-off requests belong in their source records.
            </p>
          </div>

          {memory ? (
            <OperationalLabelValueList title="Memory details">
              <OperationalLabelValueRow
                label="Type"
                value={TYPE_LABELS[memory.type] ?? memory.type}
              />
              <OperationalLabelValueRow
                label="Source"
                value={SOURCE_LABELS[memory.source] ?? memory.source}
              />
              <OperationalLabelValueRow
                label="Last updated"
                value={formatDisplayDate(memory.updatedAt)}
              />
            </OperationalLabelValueList>
          ) : null}
        </div>
      )}
    </SettingsDrawer>
  );
}

export function MemorySection({
  clientOrgId,
  operator = false,
  readOnly = false,
  onActions,
  onRightPanel,
}: {
  clientOrgId?: Id<"organizations">;
  operator?: boolean;
  readOnly?: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel?: (node: ReactNode) => void;
} = {}) {
  const currentOrg = useCurrentOrg();
  const orgId = clientOrgId ?? currentOrg?.orgId;
  const tenantMemories = useQuery(
    api.orgMemory.list,
    orgId && !operator ? { orgId } : "skip",
  );
  const operatorMemories = useQuery(
    api.orgMemory.listForOperator,
    orgId && operator ? { orgId } : "skip",
  );
  const createTenant = useMutation(api.orgMemory.create);
  const updateTenant = useMutation(api.orgMemory.update);
  const removeTenant = useMutation(api.orgMemory.remove);
  const createOperator = useMutation(api.orgMemory.createForOperator);
  const updateOperator = useMutation(api.orgMemory.updateForOperator);
  const removeOperator = useMutation(api.orgMemory.removeForOperator);
  const settingsActions = useSettingsActions();
  const setActions = onActions ?? settingsActions.setActions;
  const setRightPanel = onRightPanel ?? settingsActions.setRightPanel;
  const memories = (operator ? operatorMemories : tenantMemories) as
    | MemoryItem[]
    | undefined;
  const canManage = Boolean(
    orgId && !readOnly && (operator || currentOrg?.role === "admin"),
  );
  const [selectedMemoryId, setSelectedMemoryId] =
    useState<Id<"orgMemory"> | null>(null);
  const [creating, setCreating] = useState(false);
  const selectedMemory = memories?.find(
    (memory) => memory._id === selectedMemoryId,
  );

  const closeDrawer = useCallback(() => {
    setCreating(false);
    setSelectedMemoryId(null);
  }, []);

  useEffect(() => {
    setActions(
      canManage ? (
        <PillButton type="button" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New memory
        </PillButton>
      ) : null,
    );
    return () => setActions(null);
  }, [canManage, setActions]);

  useEffect(() => {
    if (!orgId || !canManage || (!creating && !selectedMemory)) {
      setRightPanel(null);
      return;
    }
    setRightPanel(
      <MemoryDrawer
        key={selectedMemory?._id ?? "new"}
        memory={selectedMemory}
        onClose={closeDrawer}
        onSave={async (content) => {
          if (selectedMemory) {
            if (operator) {
              await updateOperator({ id: selectedMemory._id, content });
            } else {
              await updateTenant({ id: selectedMemory._id, content });
            }
          } else if (operator) {
            await createOperator({ orgId, content });
          } else {
            await createTenant({ orgId, content });
          }
        }}
        onDelete={
          selectedMemory
            ? async () => {
                if (operator) {
                  await removeOperator({ id: selectedMemory._id });
                } else {
                  await removeTenant({ id: selectedMemory._id });
                }
              }
            : undefined
        }
      />,
    );
    return () => setRightPanel(null);
  }, [
    canManage,
    closeDrawer,
    createOperator,
    createTenant,
    creating,
    operator,
    orgId,
    removeOperator,
    removeTenant,
    selectedMemory,
    setRightPanel,
    updateOperator,
    updateTenant,
  ]);

  const grouped = useMemo(
    () =>
      (memories ?? []).reduce<Record<string, MemoryItem[]>>(
        (groups, memory) => {
          const key = memory.type ?? "fact";
          (groups[key] ??= []).push(memory);
          return groups;
        },
        {},
      ),
    [memories],
  );

  if (!orgId || memories === undefined) {
    return (
      <OperationalPanel
        as="div"
        className={`px-5 py-10 text-center text-muted-foreground ${typeStyle("body.default")}`}
      >
        Loading memory…
      </OperationalPanel>
    );
  }

  return (
    <div className="space-y-3">
      {!canManage ? (
        <OperationalPanel as="div" className="px-5 py-4">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            {readOnly
              ? "Company memory is read-only while an operator impersonation is active."
              : "All organization members can read company memory. Only admins can create, edit, or delete it."}
          </p>
        </OperationalPanel>
      ) : null}

      {memories.length === 0 ? (
        <OperationalPanel as="div" className="px-5 py-10 text-center">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No company memory yet
          </p>
        </OperationalPanel>
      ) : (
        MEMORY_TYPE_ORDER.filter((type) => grouped[type]?.length).map(
          (type) => (
            <OperationalPanel key={type}>
              <OperationalPanelHeader
                title={TYPE_LABELS[type] ?? type}
                action={
                  <span
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {grouped[type].length}
                  </span>
                }
                className="px-5 py-3.5"
              />
              <div className="divide-y divide-border">
                {grouped[type].map((memory) => {
                  const content = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-foreground ${typeStyle("body.default")}`}
                        >
                          {memory.content}
                        </span>
                        <span
                          className={`mt-1 block text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {SOURCE_LABELS[memory.source] ?? memory.source} ·{" "}
                          {formatDisplayDate(memory.updatedAt)}
                        </span>
                      </span>
                      {canManage ? (
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                      ) : null}
                    </>
                  );
                  return canManage ? (
                    <button
                      key={memory._id}
                      type="button"
                      onClick={() => setSelectedMemoryId(memory._id)}
                      className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-foreground/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-emphasized"
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={memory._id}
                      className="flex w-full items-start gap-3 px-5 py-3.5 text-left"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </OperationalPanel>
          ),
        )
      )}
    </div>
  );
}
