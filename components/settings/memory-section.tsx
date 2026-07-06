"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type MemoryItem = {
  _id: Id<"orgMemory">;
  type: string;
  content: string;
  source: string;
  updatedAt: number;
};

type OrgMemoryApi = typeof api.orgMemory & {
  update: FunctionReference<
    "mutation",
    "public",
    { id: Id<"orgMemory">; content: string },
    MemoryItem
  >;
  remove: FunctionReference<
    "mutation",
    "public",
    { id: Id<"orgMemory"> },
    { deleted: boolean }
  >;
};

const orgMemoryApi = api.orgMemory as OrgMemoryApi;

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

const listArgs = {};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Uncaught Error: /, "")
    : "Failed to update memory";
}

export function MemorySection() {
  const memories = useCachedQuery(
    "orgMemory.list",
    api.orgMemory.list,
    listArgs,
  ) as MemoryItem[] | undefined;
  const updateMemory = useMutation(orgMemoryApi.update);
  const removeMemory = useMutation(orgMemoryApi.remove);
  const updateCachedMemory = useUpdateCachedQuery<MemoryItem[], typeof listArgs>(
    "orgMemory.list",
  );
  const [editingId, setEditingId] = useState<Id<"orgMemory"> | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<Id<"orgMemory"> | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"orgMemory"> | null>(null);

  function startEdit(memory: MemoryItem) {
    setEditingId(memory._id);
    setDraft(memory.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  async function saveEdit(memory: MemoryItem) {
    const content = draft.trim().replace(/\s+/g, " ");
    if (!content) {
      toast.error("Memory cannot be empty");
      return;
    }
    if (content === memory.content) {
      cancelEdit();
      return;
    }

    setSavingId(memory._id);
    try {
      await updateMemory({ id: memory._id, content });
      const updatedAt = dayjs().valueOf();
      await updateCachedMemory(listArgs, (current) =>
        current.map((row) =>
          row._id === memory._id ? { ...row, content, updatedAt } : row,
        ),
      );
      cancelEdit();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  async function deleteMemory(memory: MemoryItem) {
    if (!window.confirm("Delete this memory item?")) return;

    setDeletingId(memory._id);
    try {
      await removeMemory({ id: memory._id });
      await updateCachedMemory(listArgs, (current) =>
        current.filter((row) => row._id !== memory._id),
      );
      if (editingId === memory._id) cancelEdit();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  if (memories === undefined) {
    return (
      <OperationalPanel as="div" className="px-5 py-10 text-center text-base text-muted-foreground/60">
        Loading memory...
      </OperationalPanel>
    );
  }

  if (memories.length === 0) {
    return (
      <OperationalPanel as="div" className="px-5 py-10 text-center">
        <p className="text-base text-muted-foreground">No memory items</p>
      </OperationalPanel>
    );
  }

  const grouped = memories.reduce<Record<string, MemoryItem[]>>((acc, memory) => {
    const key = memory.type ?? "fact";
    if (!acc[key]) acc[key] = [];
    acc[key].push(memory);
    return acc;
  }, {});

  const order = ["fact", "preference", "risk_note", "observation"];

  return (
    <div className="space-y-3">
      {order
        .filter((type) => grouped[type]?.length)
        .map((type) => (
          <OperationalPanel key={type}>
            <OperationalPanelHeader
              title={TYPE_LABELS[type] ?? type}
              action={
                <span className="text-label text-muted-foreground/50">
                  {grouped[type].length}
                </span>
              }
              className="px-5 py-3.5"
            />
            <div className="divide-y divide-foreground/6">
              {grouped[type].map((memory) => {
                const isEditing = editingId === memory._id;
                const isSaving = savingId === memory._id;
                const isDeleting = deletingId === memory._id;
                return (
                  <OperationalItem
                    key={memory._id}
                    className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          className="min-h-20 w-full resize-y rounded-md border border-foreground/10 bg-background px-3 py-2 text-base leading-snug text-foreground outline-none transition-colors focus:border-foreground/25 focus:ring-2 focus:ring-foreground/5"
                          autoFocus
                        />
                      ) : (
                        <p className="text-base leading-snug text-foreground">
                          {memory.content}
                        </p>
                      )}
                      <p className="mt-1 text-label text-muted-foreground/50">
                        {SOURCE_LABELS[memory.source] ?? memory.source}
                        {" · "}
                        {dayjs(memory.updatedAt).format("M/D/YYYY")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isEditing ? (
                        <>
                          <PillButton
                            variant="icon"
                            size="compact"
                            label="Save memory"
                            disabled={isSaving}
                            onClick={() => void saveEdit(memory)}
                          >
                            {isSaving ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                          </PillButton>
                          <PillButton
                            variant="icon"
                            size="compact"
                            label="Cancel edit"
                            disabled={isSaving}
                            onClick={cancelEdit}
                          >
                            <X className="size-3.5" />
                          </PillButton>
                        </>
                      ) : (
                        <PillButton
                          variant="icon"
                          size="compact"
                          label="Edit memory"
                          disabled={isDeleting}
                          onClick={() => startEdit(memory)}
                        >
                          <Pencil className="size-3.5" />
                        </PillButton>
                      )}
                      <PillButton
                        variant="icon"
                        size="compact"
                        label="Delete memory"
                        disabled={isSaving || isDeleting}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void deleteMemory(memory)}
                      >
                        {isDeleting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </PillButton>
                    </div>
                  </OperationalItem>
                );
              })}
            </div>
          </OperationalPanel>
        ))}
    </div>
  );
}
