"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { VectorSpace } from "@/components/vector-space";

const INTEL_CATEGORY_COLORS: Record<string, string> = {
  company_info: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  operations: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  financial: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  coverage: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
  risk: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  relationship: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  observation: "bg-gray-50 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const INTEL_SOURCE_COLORS: Record<string, string> = {
  email: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  application: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  chat: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  extraction: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  dream: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  manual: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const INTEL_CONFIDENCE_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  inferred: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  stale: "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-500",
};

export function IntelligenceTab() {
  const entries = useQuery(api.intelligence.list, {});
  const removeEntry = useMutation(api.intelligence.remove);
  const projectIntelligence = useAction(api.actions.vectorProjection.projectIntelligence);
  const [vectorData, setVectorData] = useState<{ points: any[]; totalEntries: number } | null>(null);
  const [loadingVectors, setLoadingVectors] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const totalEntries = entries?.length ?? 0;

  const categoryBreakdown = useMemo(() => {
    if (!entries) return [];
    const counts = new Map<string, number>();
    for (const e of entries) {
      counts.set(e.category, (counts.get(e.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
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

  if (entries === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Total Entries</p>
          <p className="text-2xl font-semibold text-foreground mt-1 font-mono">{totalEntries.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-4">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Categories</p>
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
        <VectorSpace points={vectorData.points} totalChunks={vectorData.totalEntries} />
      ) : loadingVectors ? (
        <div className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center" style={{ height: 520 }}>
          <div className="text-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-label-sm text-muted-foreground/30">Computing vector projections...</p>
          </div>
        </div>
      ) : totalEntries > 0 ? (
        <div className="rounded-lg border border-foreground/6 bg-background flex items-center justify-center" style={{ height: 520 }}>
          <button
            type="button"
            onClick={() => {
              setLoadingVectors(true);
              projectIntelligence()
                .then((result: any) => { if (result?.points) setVectorData(result); })
                .catch(() => {})
                .finally(() => setLoadingVectors(false));
            }}
            className="text-center cursor-pointer group"
          >
            <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2 group-hover:text-muted-foreground/40 transition-colors" />
            <p className="text-body-sm text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">Load intelligence vector space</p>
          </button>
        </div>
      ) : null}

      {/* Intelligence entries list */}
      {entries.length > 0 ? (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">Intelligence Entries</h3>
            <p className="text-label-sm text-muted-foreground mt-0.5">
              Facts and observations learned from emails, applications, and conversations.
            </p>
          </div>
          <div className="divide-y divide-foreground/4">
            {entries.map((entry) => (
              <div key={entry._id} className="px-5 py-3 flex items-start gap-3 group hover:bg-foreground/[0.015] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm text-foreground leading-relaxed line-clamp-2">{entry.content}</p>
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
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(entry._id)}
                  disabled={removingId === entry._id}
                  className="p-1 text-muted-foreground/20 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-0.5"
                >
                  {removingId === entry._id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-5 py-8 text-center">
          <Brain className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground">No intelligence entries yet</p>
          <p className="text-label-sm text-muted-foreground/50 mt-0.5">
            Intelligence is automatically learned from emails, applications, and conversations.
          </p>
        </div>
      )}
    </div>
  );
}
