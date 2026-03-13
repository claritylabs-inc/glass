"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

const CATEGORIES = [
  { value: "company_info", label: "Company Info" },
  { value: "operations", label: "Operations" },
  { value: "financial", label: "Financial" },
  { value: "coverage", label: "Coverage" },
  { value: "loss_history", label: "Loss History" },
  { value: "declarations", label: "Declarations" },
  { value: "other", label: "Other" },
] as const;

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-gray-100 text-gray-600",
  onboarding: "bg-blue-50 text-blue-600",
  application: "bg-violet-50 text-violet-600",
  user_email: "bg-amber-50 text-amber-600",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_COLORS[source] ?? SOURCE_COLORS.manual}`}
    >
      {source}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
        confidence === "confirmed"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-amber-50 text-amber-600"
      }`}
    >
      {confidence}
    </span>
  );
}

interface ContextEntry {
  _id: Id<"orgBusinessContext">;
  key: string;
  value: string;
  category: string;
  source: string;
  confidence: string;
  fieldType?: string;
}

function ContextEntryRow({ entry }: { entry: ContextEntry }) {
  const upsert = useMutation(api.businessContext.upsert);
  const remove = useMutation(api.businessContext.remove);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.value);

  async function handleSave() {
    try {
      await upsert({
        category: entry.category,
        key: entry.key,
        value: editValue,
        source: "manual",
      });
      setEditing(false);
      toast.success("Updated");
    } catch {
      toast.error("Failed to update");
    }
  }

  async function handleDelete() {
    try {
      await remove({ id: entry._id });
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    }
  }

  // Format key for display: snake_case → Title Case
  const displayKey = entry.key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <tr className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors group">
      <td className="px-4 py-2.5 align-top">
        <p className="text-body-sm text-foreground font-medium">{displayKey}</p>
      </td>
      <td className="px-4 py-2.5 align-top">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 text-body-sm border border-foreground/10 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-foreground/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setEditing(false); setEditValue(entry.value); }
              }}
            />
            <button type="button" onClick={handleSave} className="text-emerald-600 hover:text-emerald-700 cursor-pointer">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setEditValue(entry.value); }}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-body-sm text-muted-foreground">{entry.value}</p>
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap hidden sm:table-cell align-top">
        <div className="flex items-center gap-1.5">
          <SourceBadge source={entry.source} />
          <ConfidenceBadge confidence={entry.confidence} />
        </div>
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        {!editing && (
          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1 text-muted-foreground/40 hover:text-foreground cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-1 text-muted-foreground/40 hover:text-red-500 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function CategorySection({
  category,
  label,
  entries,
}: {
  category: string;
  label: string;
  entries: ContextEntry[];
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full text-left table-fixed">
          <colgroup>
            <col className="w-[200px]" />
            <col />
            <col className="w-[160px] hidden sm:table-column" />
            <col className="w-[72px]" />
          </colgroup>
          <thead>
            <tr
              className="bg-foreground/[0.02] cursor-pointer h-10"
              onClick={() => setExpanded(!expanded)}
            >
              <th className="px-4 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ verticalAlign: "middle" }}>
                <span className="inline-flex items-center gap-1.5 leading-none">
                  {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                  {label}
                </span>
              </th>
              <th className="px-4 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ verticalAlign: "middle" }}>
                {expanded ? "Value" : ""}
              </th>
              <th className="px-4 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell" style={{ verticalAlign: "middle" }}>
                {expanded ? "Source" : ""}
              </th>
              <th className="px-4 text-right" style={{ verticalAlign: "middle" }}>
                <span className="text-label-sm font-normal text-muted-foreground/40 normal-case tracking-normal leading-none">
                  {entries.length}
                </span>
              </th>
            </tr>
          </thead>
          {expanded && (
            <tbody>
              {entries.map((entry) => (
                <ContextEntryRow key={entry._id} entry={entry} />
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

export function BusinessContextManager({
  showAddForm: showAddFormProp,
  onShowAddFormChange,
}: {
  showAddForm?: boolean;
  onShowAddFormChange?: (show: boolean) => void;
} = {}) {
  const contextData = useQuery(api.businessContext.list);
  const upsert = useMutation(api.businessContext.upsert);
  const [showAddFormInternal, setShowAddFormInternal] = useState(false);
  const showAddForm = showAddFormProp ?? showAddFormInternal;
  const setShowAddForm = onShowAddFormChange ?? setShowAddFormInternal;
  const [newCategory, setNewCategory] = useState("company_info");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  async function handleAdd() {
    if (!newKey.trim() || !newValue.trim()) {
      toast.error("Key and value are required");
      return;
    }
    try {
      await upsert({
        category: newCategory,
        key: newKey
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_"),
        value: newValue.trim(),
        source: "manual",
      });
      setNewKey("");
      setNewValue("");
      setShowAddForm(false);
      toast.success("Added");
    } catch {
      toast.error("Failed to add");
    }
  }

  if (contextData === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const allEntries = Object.values(contextData).flat() as ContextEntry[];

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">
        Business context is auto-saved from application answers and used to pre-fill future applications.
      </p>

      {showAddForm && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-label-sm text-muted-foreground/60 mb-1 block">
                Category
              </label>
              <SearchableSelect
                options={CATEGORIES.map((cat) => ({ value: cat.value, label: cat.label }))}
                value={newCategory}
                onChange={setNewCategory}
                placeholder="Select category..."
              />
            </div>
            <div>
              <label className="text-label-sm text-muted-foreground/60 mb-1 block">
                Key
              </label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. company_name"
                className="w-full text-body-sm border border-foreground/10 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-foreground/20"
              />
            </div>
            <div>
              <label className="text-label-sm text-muted-foreground/60 mb-1 block">
                Value
              </label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full text-body-sm border border-foreground/10 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </PillButton>
            <PillButton variant="primary" onClick={handleAdd}>
              Add
            </PillButton>
          </div>
        </div>
      )}

      {allEntries.length === 0 && !showAddForm ? (
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-8 text-center">
          <p className="text-body-sm text-muted-foreground/50">
            No business context saved yet. Context is automatically learned from application answers,
            or you can add entries manually.
          </p>
        </div>
      ) : (
        CATEGORIES.map((cat) => {
          const entries = ((contextData as any)[cat.value] ?? []) as ContextEntry[];
          if (entries.length === 0) return null;
          return (
            <CategorySection
              key={cat.value}
              category={cat.value}
              label={cat.label}
              entries={entries}
            />
          );
        })
      )}
    </div>
  );
}
