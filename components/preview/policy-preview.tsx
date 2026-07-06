"use client";

import {
  useState,
  useEffect,
  useMemo,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import dayjs from "dayjs";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { PillButton } from "@/components/ui/pill-button";
import { useCachedPolicyDetail } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  collectSourceSpanIds,
  evidenceSpansForIds,
  highlightBoxesForSpans,
  SourceEvidenceButton,
  type SourceSpanDoc,
} from "@/app/policies/[id]/source-provenance";

interface DocumentOutlineNode {
  id?: string;
  title?: string;
  originalTitle?: string;
  pageStart?: number;
  pageEnd?: number;
  formNumber?: string;
  formTitle?: string;
  excerpt?: string;
  content?: string;
  summary?: string;
  sourceSpanIds?: string[];
  children?: DocumentOutlineNode[];
}

interface PolicyPreviewProps {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  onHeaderInfo?: (info: { carrier: string; policyNum?: string }) => void;
  onHeaderActions?: (actions: {
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      coordinateWidth?: number;
      coordinateHeight?: number;
    }>;
  }) => void;
}

function asOutlineNodeArray(value: unknown): DocumentOutlineNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DocumentOutlineNode =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function documentOutlineFromPolicy(policy: unknown): DocumentOutlineNode[] {
  if (!policy || typeof policy !== "object") return [];
  const record = policy as Record<string, unknown>;
  const document =
    record.document && typeof record.document === "object" && !Array.isArray(record.document)
      ? (record.document as Record<string, unknown>)
      : undefined;

  const topLevelOutline = asOutlineNodeArray(record.documentOutline);
  if (topLevelOutline.length > 0) return topLevelOutline;
  const nestedOutline = asOutlineNodeArray(document?.outline);
  if (nestedOutline.length > 0) return nestedOutline;
  return asOutlineNodeArray(document?.documentOutline);
}

function nodeTitle(node: DocumentOutlineNode) {
  return node.title || node.originalTitle || "Untitled section";
}

function pageRange(node: DocumentOutlineNode) {
  if (node.pageStart == null) return undefined;
  return node.pageEnd && node.pageEnd !== node.pageStart
    ? `p.${node.pageStart}-${node.pageEnd}`
    : `p.${node.pageStart}`;
}

function nodeExcerpt(node: DocumentOutlineNode) {
  return node.excerpt || node.summary || node.content;
}

export function PolicyPreview({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
  onHeaderInfo,
  onHeaderActions,
}: PolicyPreviewProps) {
  const policy = useCachedPolicyDetail(id as Id<"policies">);
  const documentOutline = useMemo(
    () => documentOutlineFromPolicy(policy),
    [policy],
  );
  const previewSourceSpanIds = useMemo(
    () =>
      [
        ...new Set([
          ...(citedSourceSpanIds ?? []),
          ...collectSourceSpanIds(documentOutline),
        ]),
      ].slice(0, 256),
    [citedSourceSpanIds, documentOutline],
  );
  const fileUrl = useCachedQuery(
    "policies.getPolicyFileUrl.preview",
    api.policies.getPolicyFileUrl,
    policy ? { policyId: policy._id } : "skip",
  );
  const [showAllTypes, setShowAllTypes] = useState(false);
  const sourceSpans = useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.preview",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    previewSourceSpanIds.length
      ? {
          policyId: id as Id<"policies">,
          spanIds: previewSourceSpanIds,
        }
      : "skip",
  ) as SourceSpanDoc[] | undefined;
  const citedSourceSpans = useMemo(
    () =>
      citedSourceSpanIds?.length
        ? evidenceSpansForIds(sourceSpans, citedSourceSpanIds)
        : [],
    [citedSourceSpanIds, sourceSpans],
  );

  // Notify parent of header info
  const carrier = policy?.carrier || "Unknown carrier";
  const policyNum = policy?.policyNumber;

  useEffect(() => {
    if (policy && onHeaderInfo) {
      onHeaderInfo({ carrier, policyNum });
    }
  }, [carrier, policyNum, policy, onHeaderInfo]);

  const highlightBoxes = useMemo(
    () => highlightBoxesForSpans(citedSourceSpans),
    [citedSourceSpans],
  );
  const citedPage = page ?? highlightBoxes[0]?.page;

  useEffect(() => {
    if (fileUrl && onHeaderActions) {
      onHeaderActions({ fileUrl, policyId: id, page: citedPage, highlightBoxes });
    }
  }, [fileUrl, id, citedPage, onHeaderActions, highlightBoxes]);

  if (!policy) {
    return <div className="min-h-24" />;
  }

  const types = policy.policyTypes ?? [];
  const fileCount = (policy as { files?: unknown[] }).files?.length ?? 0;
  const hasLegacyCitations = Boolean(citedSections?.length || citedCoverageNames?.length);

  const visibleTypes = showAllTypes ? types : types.slice(0, 2);
  const hasMoreTypes = types.length > 2;

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      {policy.summary && (
        <div className="min-w-0">
          <p className="wrap-break-word text-base leading-relaxed text-foreground/90">
            {policy.summary}
          </p>
        </div>
      )}

      {fileCount > 1 && (
        <p className="text-label text-muted-foreground/50">
          Combined from {fileCount} files
        </p>
      )}

      {citedSourceSpans.length > 0 && (
        <div className="min-w-0 rounded-md border border-foreground/8 bg-foreground/[0.02]">
          <div className="border-b border-foreground/6 px-3 py-2">
            <p className="text-label font-medium text-foreground">
              Exact source locations
            </p>
          </div>
          <div className="divide-y divide-foreground/6">
            {citedSourceSpans.slice(0, 5).map((span) => (
              <div key={span.spanId} className="px-3 py-2">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <span className="text-label font-medium text-muted-foreground">
                    p.{span.pageStart ?? span.bbox?.[0]?.page ?? "?"}
                  </span>
                  <span className="truncate text-label text-muted-foreground/50">
                    {span.sectionId ?? span.formNumber ?? (span.metadata?.elementType as string | undefined) ?? "Source span"}
                  </span>
                </div>
                <p className="line-clamp-3 text-base leading-relaxed text-foreground/80">
                  {span.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="min-w-0 space-y-3">
        {types.length > 0 && (
          <div className="min-w-0">
            <p className="text-label text-muted-foreground/50 mb-1.5">
              Policy types
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {visibleTypes.map((t) => (
                <span
                  key={t}
                  className="text-base px-2.5 py-1 rounded-full bg-secondary text-muted-foreground"
                >
                  {POLICY_TYPE_LABELS[t] ?? t}
                </span>
              ))}
              {hasMoreTypes && !showAllTypes && (
                <PillButton
                  size="compact"
                  variant="secondary"
                  onClick={() => setShowAllTypes(true)}
                >
                  +{types.length - 2} more
                </PillButton>
              )}
            </div>
          </div>
        )}

        {(policy.effectiveDate || policy.expirationDate) && (
          <div className="min-w-0">
            <p className="text-label text-muted-foreground/50 mb-1">
              Policy period
            </p>
            <p className="text-base text-muted-foreground">
              {policy.effectiveDate
                ? dayjs(policy.effectiveDate).format("MMM D, YYYY")
                : "—"}
              {" — "}
              {policy.expirationDate
                ? dayjs(policy.expirationDate).format("MMM D, YYYY")
                : "—"}
            </p>
          </div>
        )}

        {policy.insuredName && (
          <div className="min-w-0">
            <p className="text-label text-muted-foreground/50 mb-1">Insured</p>
            <p className="wrap-break-word text-base text-muted-foreground">
              {policy.insuredName}
            </p>
          </div>
        )}
      </div>

      {documentOutline.length > 0 ? (
        <DocumentOutlinePreview
          nodes={documentOutline}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl ?? undefined}
        />
      ) : (
        <ReextractNotice hasLegacyCitations={hasLegacyCitations} />
      )}
    </div>
  );
}

function ReextractNotice({
  hasLegacyCitations,
}: {
  hasLegacyCitations: boolean;
}) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-50/60 p-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-medium">Re-extraction required</p>
          <p className="mt-1 text-label leading-5 opacity-80">
            This policy was extracted before source-native document outlines were
            available. Re-extract it to preview the source-order structure and
            exact source locations.
          </p>
          {hasLegacyCitations && (
            <p className="mt-2 text-label leading-5 opacity-80">
              Legacy section citations are not shown in this preview.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentOutlinePreview({
  nodes,
  sourceSpans,
  fileUrl,
}: {
  nodes: DocumentOutlineNode[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-base font-medium text-muted-foreground/60">
          Source document outline
        </p>
      </div>
      <div className="min-w-0 divide-y divide-foreground/6 overflow-hidden rounded-lg border border-foreground/8 bg-card text-card-foreground">
        {nodes.map((node, index) => (
          <OutlineNodePreview
            key={node.id ?? `${nodeTitle(node)}-${index}`}
            node={node}
            sourceSpans={sourceSpans}
            fileUrl={fileUrl}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

function OutlineNodePreview({
  node,
  sourceSpans,
  fileUrl,
  depth,
}: {
  node: DocumentOutlineNode;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  depth: number;
}) {
  const children = asOutlineNodeArray(node.children);
  const [open, setOpen] = useState(depth === 0);
  const pages = pageRange(node);
  const excerpt = nodeExcerpt(node);
  const hasChildren = children.length > 0;

  return (
    <div className="min-w-0">
      <div
        className="flex min-w-0 items-start gap-2 px-3 py-2.5"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <button
          type="button"
          disabled={!hasChildren}
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-foreground/4 hover:text-muted-foreground disabled:cursor-default disabled:opacity-0"
          aria-label={open ? "Collapse section" : "Expand section"}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 wrap-break-word text-base font-medium text-foreground">
              {nodeTitle(node)}
            </p>
            {pages && (
              <span className="shrink-0 text-label text-muted-foreground/50">
                {pages}
              </span>
            )}
            {node.formNumber && (
              <span className="shrink-0 text-label text-muted-foreground/50">
                {node.formNumber}
              </span>
            )}
            <SourceEvidenceButton
              sourceSpanIds={node.sourceSpanIds}
              sourceSpans={sourceSpans}
              fallbackPage={node.pageStart}
              fileUrl={fileUrl}
              className="shrink-0"
            />
          </div>
          {excerpt && (
            <p className="mt-1 line-clamp-3 text-base leading-relaxed text-muted-foreground">
              {excerpt}
            </p>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <div className="border-t border-foreground/4">
          {children.map((child, index) => (
            <OutlineNodePreview
              key={child.id ?? `${nodeTitle(child)}-${depth}-${index}`}
              node={child}
              sourceSpans={sourceSpans}
              fileUrl={fileUrl}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
