"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Paperclip,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";

const PAGE_SIZE = 50;

interface EmailReviewTableProps {
  connectionId: Id<"emailConnections">;
  /** Render function for toolbar actions based on selection */
  onSelectionChange?: (selectedIds: Id<"emails">[]) => void;
}

export function EmailReviewTable({ connectionId, onSelectionChange }: EmailReviewTableProps) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.emails.listPaginated,
    { connectionId },
    { initialNumItems: PAGE_SIZE }
  );
  const totalCount = useQuery(api.emails.count, { connectionId });
  const connection = useQuery(api.connections.get, { id: connectionId });
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const scanGmail = useAction(api.actions.scanGmail.scanGmail);
  const [scanning, setScanning] = useState(false);

  const pendingCount = useMemo(
    () => results?.filter((e) => !e.processed).length ?? 0,
    [results]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    if (!results) return [];
    const list = [...results];
    list.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return sortAsc ? ta - tb : tb - ta;
    });
    return list;
  }, [results, sortAsc]);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status !== "CanLoadMore") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && status === "CanLoadMore") {
          loadMore(PAGE_SIZE);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [status, loadMore]);

  // Selection with shift+click range support
  const lastClickedRef = useRef<number | null>(null);

  const toggleSelect = (id: string, index?: number, shiftKey?: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (shiftKey && lastClickedRef.current !== null && index !== undefined) {
        const start = Math.min(lastClickedRef.current, index);
        const end = Math.max(lastClickedRef.current, index);
        for (let i = start; i <= end; i++) {
          next.add(filtered[i]._id);
        }
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }

      return next;
    });
    if (index !== undefined) lastClickedRef.current = index;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e._id)));
    }
  };

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.([...selectedIds] as Id<"emails">[]);
  }, [selectedIds, onSelectionChange]);

  async function runScanNow() {
    if (!connection) {
      toast.error("Connection not found.");
      return;
    }

    setScanning(true);
    try {
      if (connection.provider === "google") {
        await scanGmail({ connectionId });
      } else {
        await scanInbox({ connectionId });
      }
      toast.success("Scan started.");
    } catch {
      toast.error("Failed to start scan.");
    } finally {
      setScanning(false);
    }
  }

  if (status === "LoadingFirstPage") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
        <div className="rounded-lg border border-foreground/6 overflow-hidden">
          <div className="border-b border-foreground/6 bg-foreground/[0.02] px-3 py-2">
            <div className="grid grid-cols-12 gap-3">
              <Skeleton className="col-span-1 h-4 w-4" />
              <Skeleton className="col-span-4 h-4 w-24" />
              <Skeleton className="col-span-3 h-4 w-16" />
              <Skeleton className="col-span-2 h-4 w-12" />
              <Skeleton className="col-span-2 h-4 w-14" />
            </div>
          </div>
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-foreground/4 last:border-b-0 px-3 py-2.5">
                <div className="grid grid-cols-12 items-center gap-3">
                  <Skeleton className="col-span-1 h-4 w-4" />
                  <Skeleton className="col-span-4 h-4 w-11/12" />
                  <Skeleton className="col-span-3 h-4 w-10/12" />
                  <Skeleton className="col-span-2 h-4 w-14" />
                  <Skeleton className="col-span-2 h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + processing indicator */}
      <div className="flex items-center gap-3">
        <p className="text-label-sm text-muted-foreground">
          {selectedIds.size > 0
            ? `${selectedIds.size} selected`
            : `${totalCount ?? "..."} emails`}
        </p>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-label-sm text-primary">
            <Loader2 className="w-3 h-3 animate-spin" />
            Processing {pendingCount} email{pendingCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 && status !== "CanLoadMore" ? (
        <div className="rounded-lg border border-foreground/6 bg-card px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/80">No emails found yet</p>
          <p className="text-label-sm text-muted-foreground/50 mt-1">Run a scan now to pull emails into this inbox.</p>
          <div className="mt-4">
            <PillButton onClick={runScanNow} disabled={scanning || !connection}>
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {scanning ? "Starting scan..." : "Scan this inbox"}
            </PillButton>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-foreground/6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-foreground/6 bg-foreground/[0.02]">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="rounded border-foreground/20 cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Subject
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    From
                  </th>
                  <th
                    className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none"
                    onClick={() => setSortAsc(!sortAsc)}
                  >
                    Date {sortAsc ? "↑" : "↓"}
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground w-8">
                    <Paperclip className="w-3.5 h-3.5 mx-auto" />
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((email, i) => {
                  const isSelected = selectedIds.has(email._id);
                  const isInsurance = email.isInsuranceRelated === true;
                  const isNotInsurance = email.isInsuranceRelated === false;

                  return (
                    <tr
                      key={email._id}
                      onClick={(e) => toggleSelect(email._id, i, e.shiftKey)}
                      className={`border-b border-foreground/4 last:border-b-0 transition-colors cursor-pointer ${
                        isSelected ? "bg-primary/[0.04]" : "hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelect(email._id, i, e.nativeEvent instanceof MouseEvent && (e.nativeEvent as MouseEvent).shiftKey)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-foreground/20 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <p className="font-medium text-foreground truncate">
                          {email.subject || "(no subject)"}
                        </p>
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <p className="text-muted-foreground truncate">
                          {extractName(email.from)}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(email.date)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {email.hasAttachments && (
                          <Paperclip className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isInsurance ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                            Insurance
                          </span>
                        ) : isNotInsurance ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/40 text-zinc-500 dark:text-zinc-400">
                            Other
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div ref={sentinelRef} className="h-1" />
          {status === "LoadingMore" && (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-label-sm">Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Extract display name from "Name <email>" format */
function extractName(from: string): string {
  const match = from.match(/^([^<]+)</);
  if (match) return match[1].trim();
  return from;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
