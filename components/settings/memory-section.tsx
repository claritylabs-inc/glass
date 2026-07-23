"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { useCurrentOrg } from "@/hooks/use-current-org";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { formatDisplayDate } from "@/lib/date-format";

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
};

const MEMORY_TYPE_ORDER = ["fact", "preference", "risk_note", "observation"];
function errorMessage(error: unknown, fallback: string) {
  return getUserFacingErrorMessage(error, fallback);
}

function MemoryEditDrawer({
  memory,
  onOpenChange,
  onUpdated,
  onRemoved,
}: {
  memory: MemoryItem;
  onOpenChange: (open: boolean) => void;
  onUpdated: (memory: MemoryItem) => Promise<void>;
  onRemoved: (id: Id<"orgMemory">) => Promise<void>;
}) {
  const updateMemory = useMutation(api.orgMemory.update);
  const removeMemory = useMutation(api.orgMemory.remove);
  const [draft, setDraft] = useState(memory.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const normalizedDraft = draft.trim().replace(/\s+/g, " ");
  const canSave = !!normalizedDraft && normalizedDraft !== memory.content && !saving;

  async function saveMemory() {
    if (!normalizedDraft) {
      toast.error("Memory cannot be empty");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateMemory({
        id: memory._id,
        content: normalizedDraft,
      });
      await onUpdated(updated);
      toast.success("Memory updated");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update memory"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMemory() {
    setDeleting(true);
    try {
      await removeMemory({ id: memory._id });
      await onRemoved(memory._id);
      toast.success("Memory deleted");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete memory"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={onOpenChange}
      title="Edit memory"
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
              onClick={() => void deleteMemory()}
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
            <PillButton
              variant="destructive"
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </PillButton>
            <PillButton disabled={!canSave} onClick={() => void saveMemory()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </PillButton>
          </>
        )
      }
    >
      {confirmDelete ? (
        <OperationalPanel as="div" className="border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="text-base font-medium text-foreground">
                Delete this company memory?
              </p>
              <p className="mt-1 text-base text-muted-foreground">
                Glass will stop using it in future advice and servicing.
              </p>
            </div>
          </div>
        </OperationalPanel>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`memory-${memory._id}`}>Company context</Label>
            <Textarea
              id={`memory-${memory._id}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-28 resize-y"
              autoFocus
            />
          </div>

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
        </div>
      )}
    </SettingsDrawer>
  );
}

export function MemorySection() {
  const orgId = useCurrentOrg()?.orgId;
  const listArgs = useMemo(() => (orgId ? { orgId } : null), [orgId]);
  const memories = useCachedQuery(
    "orgMemory.list",
    api.orgMemory.list,
    listArgs ?? "skip",
  );
  const updateCachedMemory = useUpdateCachedQuery<
    MemoryItem[],
    { orgId: Id<"organizations"> }
  >("orgMemory.list");
  const { setRightPanel } = useSettingsActions();
  const [selectedMemoryId, setSelectedMemoryId] =
    useState<Id<"orgMemory"> | null>(null);
  const selectedMemory = memories?.find(
    (memory) => memory._id === selectedMemoryId,
  );

  const updateMemoryLocally = useCallback(
    async (updated: MemoryItem) => {
      if (!listArgs) return;
      await updateCachedMemory(listArgs, (current) =>
        current.map((row) => (row._id === updated._id ? updated : row)),
      );
    },
    [listArgs, updateCachedMemory],
  );

  const removeMemoryLocally = useCallback(
    async (id: Id<"orgMemory">) => {
      if (!listArgs) return;
      await updateCachedMemory(listArgs, (current) =>
        current.filter((row) => row._id !== id),
      );
    },
    [listArgs, updateCachedMemory],
  );

  useEffect(() => {
    setRightPanel(
      selectedMemory ? (
        <MemoryEditDrawer
          key={selectedMemory._id}
          memory={selectedMemory}
          onOpenChange={(open) => {
            if (!open) setSelectedMemoryId(null);
          }}
          onUpdated={updateMemoryLocally}
          onRemoved={removeMemoryLocally}
        />
      ) : null,
    );
    return () => setRightPanel(null);
  }, [
    removeMemoryLocally,
    selectedMemory,
    setRightPanel,
    updateMemoryLocally,
  ]);

  if (memories === undefined) {
    return (
      <OperationalPanel as="div" className="px-5 py-10 text-center text-base text-muted-foreground">
        Loading memory…
      </OperationalPanel>
    );
  }

  if (memories.length === 0) {
    return (
      <OperationalPanel as="div" className="px-5 py-10 text-center">
        <p className="text-base text-muted-foreground">No company memory yet</p>
      </OperationalPanel>
    );
  }

  const grouped = memories.reduce<Record<string, MemoryItem[]>>((acc, memory) => {
    const key = memory.type ?? "fact";
    if (!acc[key]) acc[key] = [];
    acc[key].push(memory);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {MEMORY_TYPE_ORDER.filter((type) => grouped[type]?.length).map((type) => (
        <OperationalPanel key={type}>
          <OperationalPanelHeader
            title={TYPE_LABELS[type] ?? type}
            action={
              <span className="text-base text-muted-foreground">
                {grouped[type].length}
              </span>
            }
            className="px-5 py-3.5"
          />
          <div className="divide-y divide-foreground/6">
            {grouped[type].map((memory) => (
              <button
                key={memory._id}
                type="button"
                onClick={() => setSelectedMemoryId(memory._id)}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-foreground/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/10"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base leading-snug text-foreground">
                    {memory.content}
                  </span>
                  <span className="mt-1 block text-base text-muted-foreground">
                    {SOURCE_LABELS[memory.source] ?? memory.source} ·{" "}
                    {formatDisplayDate(memory.updatedAt)}
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
              </button>
            ))}
          </div>
        </OperationalPanel>
      ))}
    </div>
  );
}
