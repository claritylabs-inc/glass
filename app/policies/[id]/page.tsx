"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import {
  ArrowLeft,
  Upload,
  Loader2,
  RefreshCw,
  MessageSquare,
  Trash2,
  Check,
  Copy,
  Play,
  Code,
  Search,
  Eye,
} from "lucide-react";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { ModeBadge } from "@/components/mode-badge";
import { MessageBubble, type Conversation } from "@/components/conversation-message";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { TerminalLog } from "@/components/terminal-log";
import { useRouter, useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePdf } from "@/components/pdf-context";
import { usePageContext } from "@/hooks/use-page-context";
import { X } from "lucide-react";

import { PolicySummary } from "./policy-summary";
import { ExtractionPanel } from "./extraction-panel";

// ─── Extraction tab helpers ───────────────────────────────────────────────────

function formatJsonForDisplay(value?: string): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

const EXTRACTION_STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  pending: {
    label: "Pending",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400",
  },
  extracting: {
    label: "Extracting",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  paused: {
    label: "Paused",
    color:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  complete: {
    label: "Complete",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  error: {
    label: "Error",
    color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
  not_insurance: {
    label: "Not Insurance",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400",
  },
};

import { ChevronRight } from "lucide-react";

function ExtractionTab({ policy }: { policy: any }) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const runSupplementary = useAction(
    api.actions.extractSupplementary.runSupplementary,
  );
  const rechunk = useAction(api.actions.rechunkPolicy.rechunk);
  const [runningMode, setRunningMode] = useState<string | null>(null);
  const [copiedBlock, setCopiedBlock] = useState<
    "rawExtraction" | "rawMetadata" | null
  >(null);

  const extractionLog: { timestamp: number; message: string }[] =
    policy.extractionLog ?? [];
  const statusCfg =
    EXTRACTION_STATUS_CONFIG[policy.extractionStatus] ??
    EXTRACTION_STATUS_CONFIG.pending;
  const rawMetadata: string | undefined = policy.rawMetadataResponse;
  const rawExtraction: string | undefined = policy.rawExtractionResponse;
  const formattedRawMetadata = useMemo(
    () => formatJsonForDisplay(rawMetadata),
    [rawMetadata],
  );
  const formattedRawExtraction = useMemo(
    () => formatJsonForDisplay(rawExtraction),
    [rawExtraction],
  );
  const hasCheckpoint = !!(policy as any).extractionCheckpoint;

  const handleRetry = async (mode: "resume" | "full") => {
    setRunningMode(mode);
    try {
      const result = (await retryExtraction({
        policyId: policy._id,
        mode,
      })) as any;
      if (result?.error) {
        toast.error(result.error as string);
      } else {
        toast.success(
          mode === "resume" ? "Resuming extraction" : "Re-extraction started",
        );
      }
    } catch {
      toast.error("Re-extraction failed");
    } finally {
      setRunningMode(null);
    }
  };

  const handleCopyBlock = async (
    block: "rawExtraction" | "rawMetadata",
    content: string | null,
  ) => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedBlock(block);
    toast.success(
      `${block === "rawExtraction" ? "Raw extraction" : "Raw metadata"} copied`,
    );
    window.setTimeout(
      () =>
        setCopiedBlock((current) => (current === block ? null : current)),
      1200,
    );
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${statusCfg.color}`}
        >
          {statusCfg.label}
        </span>
        {policy.extractionError && (
          <span className="text-body-sm text-red-600 dark:text-red-400 flex-1 min-w-0 truncate">
            {policy.extractionError}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {hasCheckpoint && (
            <PillButton
              variant="primary"
              size="compact"
              disabled={runningMode !== null}
              onClick={() => handleRetry("resume")}
            >
              {runningMode === "resume" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Restart from checkpoint
            </PillButton>
          )}
          <PillButton
            variant="secondary"
            size="compact"
            disabled={runningMode !== null}
            onClick={() => handleRetry("full")}
          >
            {runningMode === "full" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Re-extract
          </PillButton>
          {policy.extractionStatus === "complete" && (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={runningMode !== null}
              onClick={async () => {
                setRunningMode("rechunk");
                try {
                  const result = (await rechunk({
                    policyId: policy._id,
                  })) as any;
                  if (result?.error) {
                    toast.error(result.error);
                  } else {
                    toast.success(
                      `Reindexed: ${result.newChunks} search chunks updated`,
                    );
                  }
                } catch {
                  toast.error("Reindexing failed");
                } finally {
                  setRunningMode(null);
                }
              }}
            >
              {runningMode === "rechunk" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Reindex for search
            </PillButton>
          )}
        </div>
      </div>

      {/* Extraction Log */}
      <TerminalLog
        entries={extractionLog}
        live={policy.extractionStatus === "extracting"}
        emptyMessage="No extraction events recorded"
      />

      {/* Supplementary Extraction */}
      {policy.extractionStatus === "complete" && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
          <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                Additional Details
              </p>
              {policy.supplementaryFacts?.length > 0 && (
                <span className="text-label-sm text-emerald-600 dark:text-emerald-400 font-medium">
                  {policy.supplementaryFacts.length} details extracted
                </span>
              )}
              <PillButton
                variant="secondary"
                size="compact"
                disabled={runningMode !== null}
                onClick={async () => {
                  setRunningMode("supplementary");
                  try {
                    const result = (await runSupplementary({
                      policyId: policy._id,
                      force: !!policy.supplementaryFacts?.length,
                    })) as any;
                    if (result?.error) {
                      toast.error(result.error);
                    } else {
                      toast.success(
                        `Extracted ${result.facts ?? 0} additional details`,
                      );
                    }
                  } catch {
                    toast.error("Supplementary extraction failed");
                  } finally {
                    setRunningMode(null);
                  }
                }}
              >
                {runningMode === "supplementary" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : policy.supplementaryFacts?.length ? (
                  <RefreshCw className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {policy.supplementaryFacts?.length
                  ? "Re-extract"
                  : "Extract additional details"}
              </PillButton>
            </div>
          </div>
          {policy.supplementaryFacts?.length > 0 && (
            <div className="divide-y divide-foreground/4">
              {policy.supplementaryFacts.map((fact: any, i: number) => (
                <div
                  key={i}
                  className="px-4 py-2 grid grid-cols-[1fr_1fr] gap-x-4"
                >
                  <span className="text-body-sm text-muted-foreground break-words">
                    {fact.key}
                    {fact.subject && (
                      <span className="block text-label-sm text-muted-foreground/40">
                        {fact.subject}
                      </span>
                    )}
                  </span>
                  <span className="text-body-sm text-foreground break-words">
                    {fact.value}
                    {fact.context && (
                      <span className="block text-label-sm text-muted-foreground/40">
                        {fact.context}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!policy.supplementaryFacts?.length && (
            <div className="px-4 py-3 text-body-sm text-muted-foreground/50">
              No additional details extracted yet. Run extraction to capture
              extra policy information for better querying.
            </div>
          )}
        </div>
      )}

      {/* Raw Data */}
      {(rawExtraction || rawMetadata) && (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
          <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-muted-foreground" />
              <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Raw Data
              </p>
            </div>
          </div>
          {rawExtraction && (
            <details className="group/raw">
              <summary className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-muted-foreground cursor-pointer hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
                <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
                <span className="flex-1">
                  Raw extraction response (
                  {(rawExtraction.length / 1024).toFixed(1)} KB)
                </span>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleCopyBlock(
                      "rawExtraction",
                      formattedRawExtraction,
                    );
                  }}
                >
                  <PillButton size="compact" variant="icon" label="Copy JSON">
                    {copiedBlock === "rawExtraction" ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </PillButton>
                </span>
              </summary>
              <div className="px-4 pb-3 max-h-[32rem] overflow-y-auto overflow-x-hidden">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {formattedRawExtraction}
                </pre>
              </div>
            </details>
          )}
          {rawMetadata && (
            <details className="group/rawmeta border-t border-foreground/4">
              <summary className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-muted-foreground cursor-pointer hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
                <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/rawmeta:rotate-90" />
                <span className="flex-1">
                  Raw metadata response (
                  {(rawMetadata.length / 1024).toFixed(1)} KB)
                </span>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleCopyBlock("rawMetadata", formattedRawMetadata);
                  }}
                >
                  <PillButton size="compact" variant="icon" label="Copy JSON">
                    {copiedBlock === "rawMetadata" ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </PillButton>
                </span>
              </summary>
              <div className="px-4 pb-3 max-h-[32rem] overflow-y-auto overflow-x-hidden">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {formattedRawMetadata}
                </pre>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Conversations tab ────────────────────────────────────────────────────────

type PolicyThread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};

function PolicyConversationsTab({
  conversations,
}: {
  conversations: Conversation[] | undefined;
}) {
  const threads = useMemo(() => {
    if (!conversations) return undefined;
    const convs = conversations as unknown as Conversation[];
    const threadMap = new Map<string, PolicyThread>();

    for (const conv of convs) {
      const rootId = (conv.threadId ?? conv._id) as string;
      const existing = threadMap.get(rootId);
      if (existing) {
        existing.messages.push(conv);
        if (conv._creationTime > existing.latestTime)
          existing.latestTime = conv._creationTime;
      } else {
        threadMap.set(rootId, {
          root: conv.threadId
            ? convs.find((c) => c._id === conv.threadId) ?? conv
            : conv,
          messages: [conv],
          latestTime: conv._creationTime,
        });
      }
    }

    for (const thread of threadMap.values()) {
      thread.messages.sort((a, b) => a._creationTime - b._creationTime);
    }

    return Array.from(threadMap.values()).sort(
      (a, b) => b.latestTime - a.latestTime,
    );
  }, [conversations]);

  if (conversations === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-12 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
        <p className="text-body-sm text-muted-foreground/50 mb-1">
          No conversations about this policy
        </p>
        <p className="text-label-sm text-muted-foreground/30">
          When Prism references this policy in email conversations, they&apos;ll
          appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-foreground/6 bg-foreground/2">
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
              Subject
            </th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">
              From
            </th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">
              Mode
            </th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
              Messages
            </th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const root = thread.root;
            const msgCount = thread.messages.reduce(
              (n, m) => n + 1 + (m.responseBody ? 1 : 0),
              0,
            );
            return (
              <tr
                key={root._id}
                className="border-b border-foreground/4 last:border-0 hover:bg-foreground/[0.02] transition-colors"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/agent/thread/${root._id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {root.subject}
                  </Link>
                  <p className="text-label-sm text-muted-foreground/40 mt-0.5">
                    {dayjs(thread.latestTime).format("MMM D, YYYY")}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {root.fromName ?? root.fromEmail}
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <ModeBadge mode={root.mode} />
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground/60 tabular-nums">
                  {msgCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Activity tab ─────────────────────────────────────────────────────────────

const AUDIT_ACTION_CONFIG: Record<string, { dotColor: string; title: string }> =
  {
    created: { dotColor: "bg-blue-500", title: "Policy created" },
    extraction_started: {
      dotColor: "bg-amber-500",
      title: "Extraction started",
    },
    extraction_complete: {
      dotColor: "bg-emerald-500",
      title: "Extraction complete",
    },
    extraction_error: { dotColor: "bg-red-500", title: "Extraction failed" },
    re_extraction: {
      dotColor: "bg-violet-500",
      title: "Re-extraction triggered",
    },
    pdf_uploaded: { dotColor: "bg-sky-500", title: "PDF uploaded" },
    deleted: { dotColor: "bg-red-400", title: "Policy deleted" },
    restored: { dotColor: "bg-emerald-500", title: "Policy restored" },
    dismissed: { dotColor: "bg-gray-400", title: "Policy dismissed" },
    agent_referenced: {
      dotColor: "bg-primary-light",
      title: "Referenced by Prism",
    },
  };

function PolicyActivityTab({ policyId }: { policyId: string }) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as any,
  });

  if (entries === undefined) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-foreground/5 animate-pulse" />
            <div className="h-3.5 w-40 bg-foreground/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground/50 py-8 text-center">
        No activity recorded yet
      </p>
    );
  }

  const groups: { label: string; entries: typeof entries }[] = [];
  for (const entry of entries) {
    const label = dayjs(entry._creationTime).format("MMM D, YYYY");
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">
            {group.label}
          </p>
          <div className="space-y-0">
            {group.entries.map((entry) => {
              const cfg = AUDIT_ACTION_CONFIG[entry.action] ?? {
                dotColor: "bg-gray-400",
                title: entry.action,
              };
              return (
                <div
                  key={entry._id}
                  className="flex items-baseline gap-2.5 py-1"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor} shrink-0 translate-y-[-1px]`}
                  />
                  <span className="text-body-sm text-foreground">
                    {cfg.title}
                  </span>
                  {entry.detail && (
                    <span className="text-label-sm text-muted-foreground/40 truncate min-w-0">
                      {entry.detail}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/30 shrink-0 ml-auto tabular-nums">
                    {dayjs(entry._creationTime).format("h:mm A")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ViewPdfButton ────────────────────────────────────────────────────────────

function ViewPdfButton({ url }: { url?: string | null }) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="primary"
      size="compact"
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="w-3.5 h-3.5" />
      {isPdfOpen ? "Hide PDF" : "View PDF"}
    </PillButton>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const policy = useQuery(api.policies.get, { id: id as any });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const reExtract = useAction(api.actions.reExtractFromFile.reExtractFromFile);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);

  const [reExtracting, setReExtracting] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<
    "details" | "conversations" | "activity" | "extraction"
  >("details");

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const types =
        policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
      });
    }
    return () => setPageContext(null);
  }, [policy, setPageContext]);

  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (fileUrl && !didAutoOpen.current) {
      didAutoOpen.current = true;
      preloadPdfUrl(fileUrl);
      if (initialPage) {
        openWithUrl(fileUrl, initialPage);
      }
    }
  }, [fileUrl, initialPage, openWithUrl, preloadPdfUrl]);

  const conversations = useQuery(
    api.agentConversations.listByPolicyId,
    policy ? { policyId: policy._id } : "skip",
  );

  // ── Loading / not-found states ──────────────────────────────────────────────

  if (policy === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="flex items-start justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-48 mb-2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3"
            >
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  if (policy === null) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">Policy not found</p>
          <Link
            href="/policies"
            className="text-primary hover:underline text-body-sm"
          >
            Back to policies
          </Link>
        </div>
      </AppShell>
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const policyTypes: string[] =
    (policy as any).policyTypes ?? [(policy as any).policyType ?? "other"];
  const documentType: string = (policy as any).documentType ?? "policy";
  const isDeleted = !!(policy as any).deletedAt;
  const policyDocument: any = (policy as any).document;
  const limits: any = (policy as any).limits;
  const deductibles: any = (policy as any).deductibles;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const result = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await result.json();
      await reExtract({ policyId: policy._id, fileId: storageId });
      toast.success("PDF uploaded, re-extracting...");
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      toast.success("Policy deleted");
      router.push("/policies");
    } catch {
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  const breadcrumbLabel = (
    <>
      {policy.carrier} {policy.policyNumber}
      {documentType === "quote" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
          Quote
        </span>
      )}
    </>
  );

  const headerActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleUpload}
        className="hidden"
      />
      {!isDeleted && (
        <PillButton
          size="compact"
          variant="icon"
          label="Delete"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="w-4 h-4" />
        </PillButton>
      )}
      {policy.emailId && (
        <PillButton
          size="compact"
          variant="icon"
          label="Re-extract"
          disabled={reExtracting}
          onClick={async () => {
            setReExtracting(true);
            try {
              await retryExtraction({ policyId: id as any, mode: "full" });
            } finally {
              setReExtracting(false);
            }
          }}
        >
          <RefreshCw
            className={`w-4 h-4 ${reExtracting ? "animate-spin" : ""}`}
          />
        </PillButton>
      )}
      <PillButton
        size="compact"
        variant="icon"
        label="Upload"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
      </PillButton>
      <ViewPdfButton url={fileUrl} />
    </>
  );

  return (
    <AppShell breadcrumbDetail={breadcrumbLabel} actions={headerActions}>
      <FadeIn when={true} staggerIndex={0} duration={0.6}>
        <Link
          href="/policies"
          className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to policies
        </Link>

        {isDeleted && (
          <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5">
            <p className="text-body-sm text-red-700 dark:text-red-400 flex-1">
              This policy has been deleted.
            </p>
            <Button
              variant="outline"
              onClick={() => restorePolicy({ id: policy._id })}
              className="text-label-sm"
            >
              Restore
            </Button>
          </div>
        )}

        <div className="mb-2">
          <h1 className="!mb-0 break-all">{policy.policyNumber}</h1>
        </div>
      </FadeIn>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(v) => !v && setShowDeleteDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Policy</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{policy.policyNumber}</strong>? The policy can be restored
              later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleting}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demo data banner */}
      {(policy as any).isDemo && !demoBannerDismissed && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-4">
          <p className="text-label-sm text-amber-700 dark:text-amber-400 flex-1">
            You&apos;re viewing demo data.{" "}
            <Link
              href="/profile"
              className="underline font-medium hover:text-amber-900"
            >
              Remove demo data
            </Link>{" "}
            from Settings when you&apos;re ready.
          </p>
          <button
            type="button"
            onClick={() => setDemoBannerDismissed(true)}
            className="text-amber-500 hover:text-amber-700 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
        {(
          [
            { id: "details" as const, label: "Details" },
            {
              id: "conversations" as const,
              label: "Threads",
              count: conversations?.length,
            },
            { id: "activity" as const, label: "Activity" },
            { id: "extraction" as const, label: "Extraction" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {"count" in tab && tab.count != null && tab.count > 0 && (
                <span className="text-[10px] font-medium bg-foreground/8 text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
                  {tab.count}
                </span>
              )}
            </span>
            {activeTab === tab.id && (
              <motion.div
                layoutId="policy-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          {/* 1. Summary card — always visible, scannable */}
          <PolicySummary
            policyNumber={policy.policyNumber}
            carrier={
              (policy as any).carrierLegalName ||
              (policy as any).security ||
              policy.carrier
            }
            insuredName={policy.insuredName}
            effectiveDate={policy.effectiveDate}
            expirationDate={policy.expirationDate}
            premium={policy.premium}
            totalCost={(policy as any).totalCost}
            policyTypes={policyTypes}
            policyTermType={(policy as any).policyTermType}
            limits={limits}
            deductibles={deductibles}
            summary={policy.summary}
            isRenewal={policy.isRenewal}
            documentType={documentType}
          />

          {/* 2. Extraction details — collapsed by default */}
          {policyDocument && (
            <ExtractionPanel
              policyDocument={policyDocument}
              initialPage={initialPage}
            />
          )}
        </FadeIn>
      )}

      {activeTab === "conversations" && (
        <PolicyConversationsTab conversations={conversations} />
      )}

      {activeTab === "activity" && <PolicyActivityTab policyId={id} />}

      {activeTab === "extraction" && <ExtractionTab policy={policy} />}
    </AppShell>
  );
}
