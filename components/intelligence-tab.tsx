"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Brain, Loader2, Trash2, Search, RefreshCw, ChevronDown, Pencil, Check, X } from "lucide-react";
import { VectorSpace } from "@/components/vector-space";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";

const INTEL_CATEGORY_COLORS: Record<string, string> = {
  company_info:
    "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  products_services:
    "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
  operations:
    "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  employees:
    "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  financial:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  coverage:
    "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
  risk: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  relationship:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  clients:
    "bg-lime-50 text-lime-600 dark:bg-lime-950/40 dark:text-lime-400",
  insurance:
    "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  investors:
    "bg-pink-50 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400",
  vendors:
    "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
  partners:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  observation:
    "bg-gray-50 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const INTEL_CATEGORY_OPTIONS = [
  "company_info",
  "products_services",
  "operations",
  "employees",
  "financial",
  "coverage",
  "risk",
  "relationship",
  "clients",
  "insurance",
  "investors",
  "vendors",
  "partners",
  "observation",
] as const;

const INTEL_SOURCE_COLORS: Record<string, string> = {
  email:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  application:
    "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  chat: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  extraction:
    "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  dream:
    "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  manual:
    "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const INTEL_CONFIDENCE_COLORS: Record<string, string> = {
  confirmed:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  inferred:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  stale:
    "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-500",
};

const SUB_TABS = [
  { id: "intelligence", label: "Org Intelligence", icon: Brain },
  { id: "extractions", label: "Policy Extractions", icon: Search },
] as const;

type SubTabId = (typeof SUB_TABS)[number]["id"];

function buildOptionsWithCurrent<T extends readonly string[]>(
  options: T,
  current?: string,
) {
  if (current && !options.includes(current as T[number])) {
    return [...options, current];
  }
  return [...options];
}

export function IntelligenceTab() {
  const [subTab, setSubTab] = useState<SubTabId>("intelligence");

  return (
    <div className="space-y-5">
      {/* Sub-tab switcher — underline style */}
      <div className="flex items-center border-b border-foreground/6">
        {SUB_TABS.map((tab) => {
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {subTab === "intelligence" ? (
        <OrgIntelligencePanel />
      ) : (
        <PolicyExtractionsPanel />
      )}
    </div>
  );
}

// ── Org Intelligence Panel ──

function OrgIntelligencePanel() {
  const entries = useQuery(api.intelligence.list, {});
  const removeEntry = useMutation(api.intelligence.remove);
  const updateEntry = useMutation(api.intelligence.update);
  const projectIntelligence = useAction(
    api.actions.vectorProjection.projectIntelligence,
  );
  const [vectorData, setVectorData] = useState<{
    points: any[];
    totalEntries: number;
  } | null>(null);
  const [loadingVectors, setLoadingVectors] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const totalEntries = entries?.length ?? 0;

  const categoryBreakdown = useMemo(() => {
    if (!entries) return [];
    const counts = new Map<string, number>();
    for (const e of entries) {
      counts.set(e.category, (counts.get(e.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  type EntryType = NonNullable<typeof entries>[number];

  // Sort newest first, group by month → day
  const groupedByMonth = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const sorted = [...entries].sort(
      (a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime),
    );
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    function getDayLabel(date: Date) {
      if (date.toDateString() === now.toDateString()) return "Today";
      if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    function getMonthKey(date: Date) {
      return `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`;
    }

    function getMonthLabel(date: Date) {
      if (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      )
        return "This Month";
      return date.toLocaleDateString("en-US", {
        month: "long",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
    }

    const months: Array<{
      key: string;
      label: string;
      totalCount: number;
      days: Array<{ label: string; entries: EntryType[] }>;
    }> = [];
    let curMonthKey = "";
    let curDayLabel = "";

    for (const entry of sorted) {
      const ts = entry.createdAt ?? entry._creationTime;
      const date = new Date(ts);
      const monthKey = getMonthKey(date);
      const dayLabel = getDayLabel(date);

      if (monthKey !== curMonthKey) {
        months.push({
          key: monthKey,
          label: getMonthLabel(date),
          totalCount: 0,
          days: [],
        });
        curMonthKey = monthKey;
        curDayLabel = "";
      }
      if (dayLabel !== curDayLabel) {
        months[months.length - 1].days.push({ label: dayLabel, entries: [] });
        curDayLabel = dayLabel;
      }
      const month = months[months.length - 1];
      month.days[month.days.length - 1].entries.push(entry);
      month.totalCount++;
    }
    return months;
  }, [entries]);

  useEffect(() => {
    if (entries && entries.length > 0 && !vectorData && !loadingVectors) {
      setLoadingVectors(true);
      projectIntelligence()
        .then((result: any) => {
          if (result?.points) setVectorData(result);
        })
        .catch(() => {})
        .finally(() => setLoadingVectors(false));
    }
  }, [entries, vectorData, loadingVectors, projectIntelligence]);

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await removeEntry({ id: id as any });
      toast.success("Entry removed");
    } catch {
      toast.error("Failed to remove entry");
    } finally {
      setRemovingId(null);
    }
  }

  function startEditing(id: string, content: string, category: string) {
    setEditingId(id);
    setEditContent(content);
    setEditCategory(category);
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim()) return;
    setSavingEdit(true);
    try {
      await updateEntry({
        id: editingId as any,
        content: editContent.trim(),
        category: editCategory || undefined,
      });
      toast.success("Entry updated");
      setEditingId(null);
      setEditContent("");
      setEditCategory("");
    } catch {
      toast.error("Failed to update entry");
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  if (entries === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <>
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
            Total Entries
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1 font-mono">
            {totalEntries.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
            Categories
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {categoryBreakdown.map(([cat, count]) => (
              <span
                key={cat}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${INTEL_CATEGORY_COLORS[cat] ?? INTEL_CATEGORY_COLORS.observation}`}
              >
                {cat.replace(/_/g, " ")}
                <span className="opacity-50">{count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 3D Vector Space */}
      {vectorData && vectorData.points.length > 0 ? (
        <VectorSpace
          points={vectorData.points}
          totalChunks={vectorData.totalEntries}
        />
      ) : loadingVectors ? (
        <div
          className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center"
          style={{ height: 520 }}
        >
          <div className="text-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-label-sm text-muted-foreground/30">
              Computing vector projections...
            </p>
          </div>
        </div>
      ) : totalEntries > 0 ? (
        <div
          className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center"
          style={{ height: 520 }}
        >
          <button
            type="button"
            onClick={() => {
              setLoadingVectors(true);
              projectIntelligence()
                .then((result: any) => {
                  if (result?.points) setVectorData(result);
                })
                .catch(() => {})
                .finally(() => setLoadingVectors(false));
            }}
            className="text-center cursor-pointer group"
          >
            <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2 group-hover:text-muted-foreground/40 transition-colors" />
            <p className="text-body-sm text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
              Load intelligence vector space
            </p>
          </button>
        </div>
      ) : null}

      {/* Intelligence entries — grouped by month → day, newest first */}
      {groupedByMonth.length > 0 ? (
        <div className="space-y-6">
          {groupedByMonth.map((month) => {
            const isMonthCollapsed = collapsedGroups.has(month.key);
            return (
              <div key={month.key}>
                {/* Month header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(month.key)}
                  className="w-full flex items-center gap-3 mb-3 cursor-pointer group/month"
                >
                  <h3 className="text-sm font-medium text-foreground shrink-0">
                    {month.label}
                    <span className="ml-1.5 text-muted-foreground/40 font-normal text-xs">
                      {month.totalCount}
                    </span>
                  </h3>
                  <div className="flex-1 border-b border-foreground/6" />
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground/30 group-hover/month:text-muted-foreground/50 transition-transform shrink-0 ${isMonthCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>

                {!isMonthCollapsed && (
                  <div className="space-y-3">
                    {month.days.map((day) => {
                      const isDayCollapsed = collapsedGroups.has(`${month.key}:${day.label}`);
                      return (
                        <div
                          key={day.label}
                          className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroup(`${month.key}:${day.label}`)}
                            className={`w-full px-5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-foreground/[0.03] transition-colors bg-foreground/[0.015] ${isDayCollapsed ? "" : "border-b border-foreground/6"}`}
                          >
                            <p className="text-label-sm font-medium text-muted-foreground">
                              {day.label}
                              <span className="ml-1.5 opacity-50">{day.entries.length}</span>
                            </p>
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${isDayCollapsed ? "-rotate-90" : ""}`}
                            />
                          </button>
                          {!isDayCollapsed && (
                            <div className="divide-y divide-foreground/4">
                              {day.entries.map((entry) => (
                                <div
                                  key={entry._id}
                                  className="px-5 py-3 flex items-start gap-3 group hover:bg-foreground/[0.015] transition-colors"
                                >
                                  <div className="flex-1 min-w-0">
                                    {editingId === entry._id ? (
                                      <div className="space-y-2">
                                        <div className="flex items-start gap-2">
                                          <textarea
                                            value={editContent}
                                            onChange={(e) => setEditContent(e.target.value)}
                                            className="flex-1 text-body-sm text-foreground bg-white dark:bg-white/5 border border-foreground/10 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                            rows={2}
                                            autoFocus
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                                saveEdit();
                                              } else if (e.key === "Escape") {
                                                setEditingId(null);
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={saveEdit}
                                            disabled={savingEdit || !editContent.trim()}
                                            className="p-1 text-emerald-500 hover:text-emerald-600 cursor-pointer shrink-0 mt-1"
                                          >
                                            {savingEdit ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <Check className="w-3.5 h-3.5" />
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingId(null)}
                                            className="p-1 text-muted-foreground/40 hover:text-muted-foreground cursor-pointer shrink-0 mt-1"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                        <div className="w-[220px]">
                                          <SearchableSelect
                                            options={buildOptionsWithCurrent(
                                              INTEL_CATEGORY_OPTIONS,
                                              editCategory,
                                            ).map((cat) => ({
                                              value: cat,
                                              label: cat.replace(/_/g, " "),
                                            }))}
                                            value={editCategory}
                                            onChange={setEditCategory}
                                            placeholder="Select category..."
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <p className="text-body-sm text-foreground leading-relaxed line-clamp-2">
                                          {entry.content}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${INTEL_CATEGORY_COLORS[entry.category] ?? INTEL_CATEGORY_COLORS.observation}`}
                                          >
                                            {entry.category.replace(/_/g, " ")}
                                          </span>
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${INTEL_SOURCE_COLORS[entry.source] ?? INTEL_SOURCE_COLORS.manual}`}
                                          >
                                            {entry.source}
                                          </span>
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${INTEL_CONFIDENCE_COLORS[entry.confidence] ?? INTEL_CONFIDENCE_COLORS.inferred}`}
                                          >
                                            {entry.confidence}
                                          </span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  {editingId !== entry._id && (
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-0.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          startEditing(
                                            entry._id,
                                            entry.content,
                                            entry.category,
                                          )
                                        }
                                        className="p-1 text-muted-foreground/20 hover:text-blue-500 cursor-pointer"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemove(entry._id)}
                                        disabled={removingId === entry._id}
                                        className="p-1 text-muted-foreground/20 hover:text-red-500 cursor-pointer"
                                      >
                                        {removingId === entry._id ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-8 text-center">
          <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground">
            No intelligence entries yet
          </p>
          <p className="text-label-sm text-muted-foreground/50 mt-0.5">
            Intelligence is automatically learned from emails, applications, and
            conversations.
          </p>
        </div>
      )}
    </>
  );
}

// ── Policy Extractions Panel ──

function PolicyExtractionsPanel() {
  const stats = useQuery(api.documentChunks.stats);
  const projectVectors = useAction(api.actions.vectorProjection.project);
  const rechunkAction = useAction(api.actions.rechunkPolicy.rechunk);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [vectorData, setVectorData] = useState<{
    points: any[];
    totalChunks: number;
  } | null>(null);
  const [loadingVectors, setLoadingVectors] = useState(false);

  useEffect(() => {
    if (stats && stats.totalChunks > 0 && !vectorData && !loadingVectors) {
      setLoadingVectors(true);
      projectVectors()
        .then((result: any) => {
          if (result?.points) setVectorData(result);
        })
        .catch(() => {})
        .finally(() => setLoadingVectors(false));
    }
  }, [stats, vectorData, loadingVectors, projectVectors]);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const maxPolicyCount = Math.max(
    ...stats.byPolicy.map((p) => p.count),
    1,
  );

  return (
    <>
      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
            Total Vectors
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1 font-mono">
            {stats.totalChunks.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
            Indexed Policies
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1 font-mono">
            {stats.totalPolicies.toLocaleString()}
          </p>
        </div>
      </div>

      {/* 3D Vector Space */}
      {vectorData && vectorData.points.length > 0 ? (
        <VectorSpace
          points={vectorData.points}
          totalChunks={vectorData.totalChunks}
        />
      ) : loadingVectors ? (
        <div
          className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center"
          style={{ height: 520 }}
        >
          <div className="text-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-label-sm text-muted-foreground/30">
              Computing vector projections...
            </p>
          </div>
        </div>
      ) : stats.totalChunks > 0 ? (
        <div
          className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center"
          style={{ height: 520 }}
        >
          <button
            type="button"
            onClick={() => {
              setLoadingVectors(true);
              projectVectors()
                .then((result: any) => {
                  if (result?.points) setVectorData(result);
                })
                .catch(() => {})
                .finally(() => setLoadingVectors(false));
            }}
            className="text-center cursor-pointer group"
          >
            <Search className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2 group-hover:text-muted-foreground/40 transition-colors" />
            <p className="text-body-sm text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
              Load vector space
            </p>
          </button>
        </div>
      ) : null}

      {/* Per-policy breakdown */}
      {stats.byPolicy.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">
              Index by Policy
            </h3>
            <p className="text-label-sm text-muted-foreground mt-0.5">
              Search vectors per policy. Reindex individual policies to update
              their search data.
            </p>
          </div>
          <div className="divide-y divide-foreground/4">
            {stats.byPolicy.map(({ id, carrier, policyNumber, count }) => (
              <div key={id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-medium text-foreground truncate">
                    {carrier}
                  </p>
                  <p className="text-label-sm text-muted-foreground/50 font-mono">
                    {policyNumber}
                  </p>
                </div>
                <div className="w-32 shrink-0">
                  <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/60 transition-all"
                      style={{
                        width: `${(count / maxPolicyCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-label-sm text-muted-foreground font-mono w-8 text-right shrink-0">
                  {count}
                </span>
                <PillButton
                  variant="secondary"
                  size="compact"
                  disabled={reindexingId !== null}
                  onClick={async () => {
                    setReindexingId(id);
                    try {
                      const result = (await rechunkAction({
                        policyId: id as any,
                      })) as any;
                      if (result?.error) {
                        toast.error(result.error);
                      } else {
                        toast.success(
                          `Reindexed: ${result.newChunks} chunks`,
                        );
                      }
                    } catch {
                      toast.error("Reindexing failed");
                    } finally {
                      setReindexingId(null);
                    }
                  }}
                >
                  {reindexingId === id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                </PillButton>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.totalChunks === 0 && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-8 text-center">
          <Search className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground">
            No search index data
          </p>
          <p className="text-label-sm text-muted-foreground/50 mt-0.5">
            Extract policies to populate the search index.
          </p>
        </div>
      )}
    </>
  );
}
