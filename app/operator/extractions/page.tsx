"use client";

import { useCallback, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  OperationalItem,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { normalizeCoverageName } from "@/convex/lib/coverageNames";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import {
  SourceEvidenceButton,
  collectSourceSpanIds,
  sourceSpanIdsFrom,
  usePolicySourceSpans,
  type SourceSpanDoc,
} from "@/app/policies/[id]/source-provenance";
import { OperatorSidebar } from "../operator-sidebar";
import {
  useCachedOperatorCurrent,
  useCachedOperatorExtractionTraceDetail,
  useCachedOperatorExtractionTraces,
} from "@/lib/sync/operator-cached-queries";

type TraceStatus = "running" | "complete" | "error" | "cancelled";
type TraceRow = {
  traceId: string;
  policyId: string;
  orgId: string;
  orgName: string;
  policyLabel: string;
  fileName?: string;
  documentType?: string;
  status: TraceStatus;
  trigger?: string;
  startedAt: number;
  completedAt?: number;
  lastEventAt?: number;
  totalDurationMs?: number;
  modelCallCount?: number;
  modelDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  slowestLabel?: string;
  slowestKind?: string;
  slowestDurationMs?: number;
  error?: string;
};
type TraceEvent = {
  _id: string;
  kind: "session" | "phase" | "log" | "model_call" | "embedding_batch" | "worker" | "artifact";
  timestamp: number;
  phase?: string;
  level?: string;
  message?: string;
  label?: string;
  task?: string;
  taskKind?: string;
  provider?: string;
  model?: string;
  routeSource?: string;
  transport?: string;
  attempt?: number;
  status?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  details?: unknown;
};
type ModelCallDebugDetails = {
  purpose?: string;
  callKind?: string;
  task?: string;
  taskKind?: string;
  maxOutputTokens?: number;
  systemPreview?: string;
  promptPreview?: string;
  outputPreview?: string;
  outputKind?: string;
  routePurpose?: string;
  trace?: {
    batchIndex?: number;
    batchCount?: number;
    coverageGroup?: string;
    itemCount?: number;
    startPage?: number;
    endPage?: number;
    sourceBacked?: boolean;
  };
  inputSummary?: {
    hasPdfBase64?: boolean;
    pdfBase64Chars?: number;
    hasPdfUrl?: boolean;
    pdfUrl?: string;
    hasPdfBytes?: boolean;
    pdfBytes?: number;
    fileId?: string;
    mimeType?: string;
    images?: Array<{ mimeType?: string; base64Chars?: number }>;
  };
};
type TraceDetail = {
  session: TraceRow;
  policy?: Record<string, unknown> | null;
  eventsTruncated?: boolean;
  fileUrl?: string | null;
  events: TraceEvent[];
};
type TracePanelTab = "summary" | "extracted" | "timeline" | "models" | "log";
const TRACE_PANEL_TABS = ["summary", "extracted", "timeline", "models", "log"] as const;

const ALL = "__all__";
const STATUS_LABELS: Record<string, string> = {
  [ALL]: "All statuses",
  running: "Running",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled",
};
const RANGE_LABELS: Record<"all" | "24h" | "30d" | "90d", string> = {
  all: "All time",
  "24h": "24 hours",
  "30d": "30 days",
  "90d": "90 days",
};

function formatDuration(ms?: number) {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatTokens(input?: number, output?: number) {
  const total = (input ?? 0) + (output ?? 0);
  if (!total) return "—";
  return `${total.toLocaleString()} (${(input ?? 0).toLocaleString()} in / ${(output ?? 0).toLocaleString()} out)`;
}

function formatCompactTokens(input?: number, output?: number) {
  const total = (input ?? 0) + (output ?? 0);
  if (!total) return "—";
  if (total >= 1000) return `${Math.round(total / 1000).toLocaleString()}k`;
  return total.toLocaleString();
}

function statusVariant(status: TraceStatus): "default" | "secondary" | "destructive" {
  if (status === "complete") return "default";
  if (status === "error" || status === "cancelled") return "destructive";
  return "secondary";
}

function parseTracePanelTab(value: string | null): TracePanelTab {
  return TRACE_PANEL_TABS.includes(value as TracePanelTab) ? value as TracePanelTab : "summary";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function sourceBackedDisplay(value: unknown) {
  const record = recordValue(value);
  if (!record || typeof record.value !== "string" || !record.value.trim()) {
    return null;
  }
  return {
    value: record.value,
    confidence: typeof record.confidence === "string" ? record.confidence : undefined,
    sourceSpanIds: sourceSpanIdsFrom(record),
  };
}

function profileScalarRows(
  profile: Record<string, unknown>,
  sourceSpans: SourceSpanDoc[] | undefined,
  fileUrl: string | undefined,
) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  const pushValue = (label: string, key: string) => {
    const display = sourceBackedDisplay(profile[key]);
    if (!display) return;
    rows.push({
      label,
      value: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 break-words">{display.value}</span>
          <SourceEvidenceButton
            sourceSpanIds={display.sourceSpanIds}
            sourceSpans={sourceSpans}
            fileUrl={fileUrl}
            className="shrink-0"
          />
        </span>
      ),
    });
  };

  const policyTypes = stringArray(profile.policyTypes);
  const policyTypeLabels = policyTypes.map((type) => POLICY_TYPE_LABELS[type] ?? type);
  if (policyTypeLabels.length) rows.push({ label: "Policy types", value: policyTypeLabels.join(", ") });
  pushValue("Policy number", "policyNumber");
  pushValue("Named insured", "namedInsured");
  pushValue("Insurer", "insurer");
  pushValue("Broker", "broker");
  pushValue("Effective", "effectiveDate");
  pushValue("Expiration", "expirationDate");
  pushValue("Retroactive", "retroactiveDate");
  pushValue("Premium", "premium");
  const warnings = stringArray(profile.warnings);
  if (warnings.length) rows.push({ label: "Warnings", value: warnings.join(" | ") });
  return rows;
}

function profileTableRow(row: Record<string, unknown>): Record<string, unknown> {
  return row;
}

function formatProfileLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function profileCellDisplay(value: unknown): string {
  const sourceBacked = sourceBackedDisplay(value);
  if (sourceBacked) return sourceBacked.value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map(profileCellDisplay)
      .filter((item) => item !== "—")
      .join(", ") || "—";
  }
  return "—";
}

function profileCellValue(row: Record<string, unknown>, key: string) {
  const value = profileCellDisplay(row[key]);
  return value !== "—" ? value : undefined;
}

function supportStatusVariant(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "supported") return "secondary";
  if (normalized === "unsupported" || normalized === "excluded" || normalized === "conflicting") return "destructive";
  return "outline";
}

function normalizeDisplayText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

const SMALL_TITLE_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const PRESERVED_TITLE_WORDS = new Set(["AI", "ML", "OFAC", "SIR", "TRIA"]);

function readableTitleCase(value: string) {
  const normalized = normalizeDisplayText(value);
  if (!normalized || /[a-z]/.test(normalized)) return normalized;
  return normalized
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      const segments = word.split(/([/-])/);
      const cased = segments.map((segment) => {
        if (segment === "/" || segment === "-") return segment;
        const upper = segment.toUpperCase();
        if (PRESERVED_TITLE_WORDS.has(upper)) return upper;
        if (index > 0 && SMALL_TITLE_WORDS.has(segment)) return segment;
        return segment.charAt(0).toUpperCase() + segment.slice(1);
      });
      return cased.join("");
    })
    .join(" ");
}

function cleanCoverageTitle(value?: string) {
  const normalized = normalizeDisplayText(value);
  if (!normalized) return undefined;
  const endorsementMatch = normalized.match(
    /\bENDORSEMENT\s+NO\.?\s*([A-Z0-9-]+)\s*[—-]\s*([\s\S]*?)(?=\s+(?:This endorsement|SCHEDULE|NORTHWOODS|Policy Number|THIS ENDORSEMENT CHANGES)\b|$)/i,
  );
  if (endorsementMatch) {
    return `Endorsement No. ${endorsementMatch[1]} — ${readableTitleCase(endorsementMatch[2])}`;
  }
  const sectionMatch = normalized.match(/^Endorsement\s+No\.?\s*([A-Z0-9-]+)\s*[—-]\s*([\s\S]+)$/i);
  if (sectionMatch) {
    return `Endorsement No. ${sectionMatch[1]} — ${readableTitleCase(sectionMatch[2])}`;
  }
  const coverageName = normalizeCoverageName(normalized);
  return coverageName ? readableTitleCase(coverageName) : normalized.slice(0, 140);
}

function coverageRowTitle(row: Record<string, unknown>) {
  const fromName = cleanCoverageTitle(profileCellValue(row, "name"));
  if (fromName) return fromName;
  return "Coverage";
}

function coverageMetadata(
  row: Record<string, unknown>,
  terms: Array<{ label: string; value: string }>,
) {
  const retroactiveDate = profileCellValue(row, "retroactiveDate");
  const hasRetroactiveTerm = terms.some((term) => /retroactive/i.test(term.label));
  return [
    profileCellValue(row, "formNumber"),
    profileCellValue(row, "sectionRef"),
    retroactiveDate && !hasRetroactiveTerm ? `Retroactive ${retroactiveDate}` : undefined,
  ].filter((item): item is string => Boolean(item));
}

function coverageLimitTerms(row: Record<string, unknown>) {
  const terms = Array.isArray(row.limits)
    ? row.limits.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const seen = new Set<string>();
  return terms
    .map((term) => {
      const label = cleanCoverageTitle(profileCellValue(term, "label") ?? profileCellValue(term, "kind"));
      const value = profileCellValue(term, "value")
        ?? profileCellValue(term, "limit")
        ?? profileCellValue(term, "amount");
      if (!label || !value) return null;
      const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { label, value, sourceSpanIds: sourceSpanIdsFrom(term) };
    })
    .filter((term): term is { label: string; value: string; sourceSpanIds: string[] } => Boolean(term));
}

function ProfileListSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader title={title} />
      <div>{children}</div>
    </OperationalPanel>
  );
}

function CoverageList({
  title,
  rows,
  sourceSpans,
  fileUrl,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (!rows.length) return null;
  return (
    <ProfileListSection title={title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left">
          <thead className="border-b border-foreground/6">
            <tr>
              <th className="px-4 py-2.5 text-label font-medium text-muted-foreground">
                Coverage
              </th>
              <th className="px-4 py-2.5 text-label font-medium text-muted-foreground">
                Term
              </th>
              <th className="px-4 py-2.5 text-right text-label font-medium text-muted-foreground">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const name = coverageRowTitle(row);
              const limit = profileCellDisplay(row.limit);
              const terms = coverageLimitTerms(row);
              const coverageSourceSpanIds = sourceSpanIdsFrom(row);
              const visibleTerms = terms.length
                ? terms
                : limit !== "—"
                  ? [{ label: "Limit", value: limit, sourceSpanIds: coverageSourceSpanIds }]
                  : [];
              const metadata = coverageMetadata(row, terms).join(" | ");
              return visibleTerms.map((term, termIndex) => (
                <tr
                  key={`${name}-${rowIndex}-${term.label}-${termIndex}`}
                  className="border-t border-foreground/6 first:border-t-0 hover:bg-foreground/[0.015]"
                >
                  {termIndex === 0 ? (
                    <td
                      rowSpan={visibleTerms.length}
                      className="w-[42%] px-4 py-3 align-top [overflow-wrap:anywhere]"
                    >
                      <div className="flex min-w-0 items-start gap-1.5 text-base font-normal leading-5 text-foreground">
                        <span className="min-w-0 break-words">{name}</span>
                        <SourceEvidenceButton
                          sourceSpanIds={coverageSourceSpanIds}
                          sourceSpans={sourceSpans}
                          fileUrl={fileUrl}
                          className="shrink-0"
                        />
                      </div>
                      {metadata ? (
                        <div className="mt-1 text-label leading-4 text-muted-foreground">
                          {metadata}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5 align-top text-base leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {term.label}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top text-base leading-5 text-foreground [overflow-wrap:anywhere]">
                    <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
                      <span className="min-w-0 break-words">{term.value}</span>
                      <SourceEvidenceButton
                        sourceSpanIds={term.sourceSpanIds}
                        sourceSpans={sourceSpans}
                        fileUrl={fileUrl}
                        className="shrink-0"
                      />
                    </span>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </ProfileListSection>
  );
}

function EndorsementSupportList({
  rows,
  sourceSpans,
  fileUrl,
}: {
  rows: Array<Record<string, unknown>>;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (!rows.length) return null;
  return (
    <ProfileListSection title="Endorsement support">
      {rows.map((row, rowIndex) => {
        const kind = profileCellDisplay(row.kind);
        const status = profileCellDisplay(row.status);
        const summary = profileCellDisplay(row.summary);
        const sourceSpanIds = sourceSpanIdsFrom(row);
        return (
          <OperationalItem
            key={rowIndex}
            className="px-4"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                {formatProfileLabel(kind)}
              </p>
              <SourceEvidenceButton
                sourceSpanIds={sourceSpanIds}
                sourceSpans={sourceSpans}
                fileUrl={fileUrl}
              />
              {status !== "—" ? (
                <Badge
                  variant={supportStatusVariant(status)}
                  className="font-normal"
                >
                  {formatProfileLabel(status)}
                </Badge>
              ) : null}
            </div>
            <p
              className="mt-2 min-w-0 text-base leading-5 text-foreground [overflow-wrap:anywhere]"
              title={summary !== "—" ? summary : undefined}
            >
              {summary}
            </p>
          </OperationalItem>
        );
      })}
    </ProfileListSection>
  );
}

function AdditionalInsuredEligibilityList({
  eligibility,
}: {
  eligibility?: Record<string, unknown> | null;
}) {
  if (!eligibility) return null;
  const groups = [
    {
      key: "scheduledAdditionalInsureds",
      label: "Already scheduled by endorsement",
      badge: "Scheduled",
      rows: Array.isArray(eligibility.scheduledAdditionalInsureds)
        ? eligibility.scheduledAdditionalInsureds.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
        : [],
    },
    {
      key: "withoutEndorsement",
      label: "Can be added without endorsement",
      badge: "Automatic",
      rows: Array.isArray(eligibility.withoutEndorsement)
        ? eligibility.withoutEndorsement.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
        : [],
    },
    {
      key: "requiresEndorsement",
      label: "Requires endorsement",
      badge: "Endorsement",
      rows: Array.isArray(eligibility.requiresEndorsement)
        ? eligibility.requiresEndorsement.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
        : [],
    },
    {
      key: "reviewRequired",
      label: "Needs review",
      badge: "Review",
      rows: Array.isArray(eligibility.reviewRequired)
        ? eligibility.reviewRequired.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
        : [],
    },
  ].filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <OperationalLabelValueList title="Additional insured eligibility">
      {groups.map((group) => (
        group.rows.map((row, rowIndex) => {
            const category = profileCellDisplay(row.name) !== "—"
              ? profileCellDisplay(row.name)
              : profileCellDisplay(row.category);
            return (
              <OperationalLabelValueRow
                key={`${group.key}-${rowIndex}`}
                label={group.label}
                value={category}
              />
            );
          })
      ))}
    </OperationalLabelValueList>
  );
}

function NamedAdditionalInsuredList({
  rows,
  sourceSpans,
  fileUrl,
}: {
  rows: Array<Record<string, unknown>>;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (!rows.length) return null;
  return (
    <ProfileListSection title="Named additional insureds">
      {rows.map((row, rowIndex) => {
        const name = profileCellDisplay(row.name);
        const status = profileCellDisplay(row.status);
        const scope = profileCellDisplay(row.scope);
        const endorsementTitle = profileCellDisplay(row.endorsementTitle);
        const sourceSpanIds = sourceSpanIdsFrom(row);
        return (
          <OperationalItem
            key={rowIndex}
            className="px-4"
          >
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 text-base font-normal leading-5 text-foreground [overflow-wrap:anywhere]">
                {name}
              </p>
              <SourceEvidenceButton
                sourceSpanIds={sourceSpanIds}
                sourceSpans={sourceSpans}
                fileUrl={fileUrl}
              />
              {status !== "—" ? (
                <Badge variant="outline" className="font-normal">
                  {formatProfileLabel(status)}
                </Badge>
              ) : null}
            </div>
            {scope !== "—" ? (
              <p className="mt-1.5 text-base leading-5 text-foreground [overflow-wrap:anywhere]">
                {scope}
              </p>
            ) : null}
            {endorsementTitle !== "—" ? (
              <p className="mt-1 text-label leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {endorsementTitle}
              </p>
            ) : null}
          </OperationalItem>
        );
      })}
    </ProfileListSection>
  );
}

function OperationalProfileSummary({
  policy,
  policyId,
  fileUrl,
  allowOperatorSourceAccess,
}: {
  policy?: Record<string, unknown> | null;
  policyId?: Id<"policies">;
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
}) {
  const profile = recordValue(policy?.operationalProfile);
  const profileSourceSpanIds = useMemo(
    () => (profile ? collectSourceSpanIds(profile) : []),
    [profile],
  );
  const sourceSpans = usePolicySourceSpans(policyId, profileSourceSpanIds, {
    allowOperatorAccess: allowOperatorSourceAccess,
    maxIds: 512,
  });
  if (!profile) return null;
  const scalarRows = profileScalarRows(profile, sourceSpans, fileUrl);
  const coverages = Array.isArray(profile.coverages)
    ? profile.coverages
        .map(recordValue)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map(profileTableRow)
    : [];
  const additionalInsuredEligibility = recordValue(profile.additionalInsuredEligibility);
  const additionalInsureds = Array.isArray(profile.additionalInsureds)
    ? profile.additionalInsureds
        .map(recordValue)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map(profileTableRow)
    : [];
  const endorsementSupport = Array.isArray(profile.endorsementSupport)
    ? profile.endorsementSupport
        .map(recordValue)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .filter((item) => !additionalInsuredEligibility || item.kind !== "additional_insured")
        .map(profileTableRow)
    : [];

  return (
    <div className="space-y-3">
      {scalarRows.length > 0 ? (
        <OperationalLabelValueList>
          {scalarRows.map((row) => (
            <OperationalLabelValueRow key={row.label} label={row.label} value={row.value} />
          ))}
        </OperationalLabelValueList>
      ) : null}
      <CoverageList
        title="Coverage schedules"
        rows={coverages}
        sourceSpans={sourceSpans}
        fileUrl={fileUrl}
      />
      <NamedAdditionalInsuredList
        rows={additionalInsureds}
        sourceSpans={sourceSpans}
        fileUrl={fileUrl}
      />
      <AdditionalInsuredEligibilityList eligibility={additionalInsuredEligibility} />
      <EndorsementSupportList
        rows={endorsementSupport}
        sourceSpans={sourceSpans}
        fileUrl={fileUrl}
      />
    </div>
  );
}


function humanizeTaskKind(value?: string) {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    extraction_classify: "Classify document",
    extraction_page_map: "Map policy pages",
    extraction_focused: "Extract policy fields",
    extraction_long_list: "Extract long policy lists",
    extraction_referential_lookup: "Resolve policy references",
    extraction_review: "Review extraction evidence",
    extraction_summary: "Summarize extracted policy",
    extraction_format: "Format extracted policy",
    query_attachment: "Read attachment",
    query_classify: "Classify question",
    query_reason: "Reason over documents",
    query_verify: "Verify answer evidence",
    query_respond: "Write answer",
    pce_impact_analysis: "Analyze policy change",
    pce_reply_parse: "Parse policy-change reply",
    pce_packet_generation: "Generate policy-change packet",
    extraction: "Extract policy structure",
    classification: "Classify document",
    chat: "Analyze chat context",
    analysis: "Run analysis",
  };
  return labels[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelCallTitle(event: TraceEvent) {
  const raw = event.label ?? "";
  if (raw && !/^(external\s+)?generate(Object|Text)$/i.test(raw)) return raw;
  return humanizeTaskKind(event.taskKind) ?? humanizeTaskKind(event.task) ?? "Model call";
}

function traceEventStatusLabel(event: TraceEvent) {
  if (event.error) return "failed";
  if (event.status === "complete") return "completed";
  if (event.status === "soft_failed") return "returned fallback";
  return event.status;
}

function traceEventRouteLabel(event: TraceEvent) {
  return [
    [event.provider, event.model].filter(Boolean).join(" / "),
    event.routeSource?.replace(/_/g, " "),
    event.transport,
  ].filter(Boolean).join(" · ");
}

function traceEventAttemptLabel(event: TraceEvent) {
  return event.attempt ? `attempt ${event.attempt}` : undefined;
}

function traceEventMaxTokens(event: TraceEvent) {
  const details = modelCallDebugDetails(event);
  return details?.maxOutputTokens;
}

function traceEventRoutePurpose(event: TraceEvent) {
  return modelCallDebugDetails(event)?.routePurpose?.replace(/_/g, " ");
}

function eventTitle(event: TraceEvent) {
  if (event.kind === "model_call") return modelCallTitle(event);
  return event.label ?? humanizeTaskKind(event.taskKind) ?? event.phase ?? event.message ?? event.kind;
}

function eventCaption(event: TraceEvent) {
  if (event.kind === "model_call") {
    return [
      traceEventRouteLabel(event),
      traceEventRoutePurpose(event),
      event.taskKind,
      traceEventAttemptLabel(event),
      traceEventMaxTokens(event) ? `max ${traceEventMaxTokens(event)?.toLocaleString()} out` : undefined,
      traceEventStatusLabel(event),
      event.error ? `error: ${event.error}` : undefined,
    ].filter(Boolean).join(" · ");
  }
  return [event.kind, event.status].filter(Boolean).join(" · ");
}

type TimelineRow = {
  id: string;
  event: TraceEvent;
  parentId?: string;
  label: string;
  caption: string;
  kind: TraceEvent["kind"];
  level: number;
  childCount?: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  status?: string;
};

function cleanTraceText(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^(unknown|unknown\.pdf|extracting\.\.\.)$/i.test(trimmed)) return undefined;
  const cleaned = trimmed
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && !/^(unknown|unknown\.pdf|extracting\.\.\.)$/i.test(part))
    .join(" · ");
  return cleaned || undefined;
}

function traceDisplayTitle(trace: TraceRow) {
  return cleanTraceText(trace.policyLabel) ?? cleanTraceText(trace.fileName) ?? "Extraction trace";
}

function traceDisplayFile(trace: TraceRow) {
  return cleanTraceText(trace.fileName) ?? "—";
}

function eventTiming(event: TraceEvent, session: TraceRow, level = 0): TimelineRow | null {
  const endAt = session.completedAt ?? session.lastEventAt ?? dayjs().valueOf();
  if ((event.durationMs ?? 0) > 0) {
    const durationMs = event.durationMs ?? 0;
    return {
      id: event._id,
      event,
      label: eventTitle(event),
      caption: eventCaption(event),
      kind: event.kind,
      level,
      startMs: Math.max(session.startedAt, event.timestamp - durationMs),
      endMs: event.timestamp,
      durationMs,
      status: event.status,
    };
  }
  if (event.kind === "phase" && event.status === "started" && endAt > event.timestamp) {
    return {
      id: event._id,
      event,
      label: event.phase ?? "active phase",
      caption: "phase · active",
      kind: event.kind,
      level,
      startMs: event.timestamp,
      endMs: endAt,
      durationMs: endAt - event.timestamp,
      status: "running",
    };
  }
  return null;
}

function assignTimelineChildren(parents: TimelineRow[], children: TimelineRow[]) {
  if (!parents.length) return children;
  const counts = new Map<string, number>();
  const nextChildren = children.map((child) => {
    const parent = parents
      .filter((candidate) =>
        candidate.startMs <= child.startMs &&
        candidate.endMs >= child.endMs
      )
      .sort((a, b) => a.durationMs - b.durationMs)[0];
    if (!parent) return child;
    counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    return { ...child, parentId: parent.id, level: parent.level + 1 };
  });
  for (const parent of parents) {
    parent.childCount = counts.get(parent.id) ?? 0;
  }
  return nextChildren;
}

function buildTimelineRows(events: TraceEvent[], session: TraceRow) {
  const parentRows = events
    .filter((event) =>
      (event.kind === "phase" || event.kind === "worker") &&
      event.status !== "started" &&
      (event.durationMs ?? 0) > 0
    )
    .map((event) => eventTiming(event, session, 0))
    .filter((row): row is TimelineRow => !!row)
    .sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

  const activeParentRows = events
    .filter((event) => event.kind === "phase" && event.status === "started" && event.phase)
    .filter((event) => !parentRows.some((row) => row.kind === "phase" && row.label === event.phase))
    .map((event) => eventTiming(event, session, 0))
    .filter((row): row is TimelineRow => !!row);

  const parents = [...parentRows, ...activeParentRows].sort((a, b) => a.startMs - b.startMs);
  const rawChildRows = events
    .filter((event) => event.kind === "model_call" || event.kind === "embedding_batch" || event.kind === "artifact")
    .map((event) => eventTiming(event, session, 1))
    .filter((row): row is TimelineRow => !!row);
  const childRows = assignTimelineChildren(parents, rawChildRows);

  if (parents.length) {
    return [...parents, ...childRows]
      .sort((a, b) => a.startMs - b.startMs || a.level - b.level || b.durationMs - a.durationMs);
  }

  const completedPhases = new Set(
    events
      .filter((event) => event.kind === "phase" && event.status !== "started" && event.phase)
      .map((event) => event.phase),
  );
  return events
    .filter((event) => {
      if (event.kind === "session") return false;
      if (event.kind !== "phase" || event.status !== "started" || !event.phase) return true;
      return !completedPhases.has(event.phase);
    })
    .map((event) => eventTiming(event, session, event.kind === "model_call" ? 1 : 0))
    .filter((row): row is TimelineRow => !!row)
    .sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);
}

function timelineColor(event: TraceEvent) {
  if (event.kind === "model_call") {
    if (event.error || event.status === "error") return "bg-red-500";
    if (event.status === "soft_failed") return "bg-amber-500";
    return "bg-blue-500";
  }
  if (event.kind === "phase") return "bg-foreground";
  if (event.kind === "embedding_batch") return "bg-emerald-500";
  if (event.kind === "worker") return "bg-violet-500";
  if (event.kind === "artifact") return "bg-amber-500";
  return "bg-muted-foreground";
}

function timelineInsideTextColor(event: TraceEvent) {
  return event.kind === "phase" ? "text-background" : "text-white";
}

function modelCallDebugDetails(event?: TraceEvent): ModelCallDebugDetails | null {
  if (!event?.details || typeof event.details !== "object") return null;
  return event.details as ModelCallDebugDetails;
}

function DebugPreview({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <OperationalPanel as="section">
      <OperationalPanelHeader title={label} />
      <pre className="bg-muted/20 p-3 whitespace-pre-wrap break-words font-mono text-label leading-relaxed text-foreground">
        {value}
      </pre>
    </OperationalPanel>
  );
}

function ModelCallDebugPanel({ event }: { event?: TraceEvent }) {
  if (!event) return null;
  const details = modelCallDebugDetails(event);
  if (!details) {
    return (
      <div className="rounded-lg border border-foreground/6 px-3 py-3 text-base text-muted-foreground">
        No prompt or output details were recorded for this call. Rerun the extraction to capture model-call debug payloads.
      </div>
    );
  }
  const inputSummary = details.inputSummary;
  const trace = details.trace;
  const inputRows = [
    inputSummary?.mimeType ? ["MIME type", inputSummary.mimeType] : null,
    inputSummary?.fileId ? ["File ID", inputSummary.fileId] : null,
    inputSummary?.hasPdfUrl ? ["PDF URL", inputSummary.pdfUrl ?? "present"] : null,
    inputSummary?.hasPdfBytes ? ["PDF bytes", inputSummary.pdfBytes?.toLocaleString() ?? "present"] : null,
    inputSummary?.hasPdfBase64 ? ["PDF base64", `${inputSummary.pdfBase64Chars?.toLocaleString() ?? "present"} chars`] : null,
    inputSummary?.images?.length ? ["Images", `${inputSummary.images.length} image${inputSummary.images.length === 1 ? "" : "s"}`] : null,
  ].filter((row): row is [string, string] => !!row);
  const traceRows = [
    trace?.batchIndex || trace?.batchCount ? ["Batch", `${trace.batchIndex ?? "?"} / ${trace.batchCount ?? "?"}`] : null,
    trace?.coverageGroup ? ["Coverage group", trace.coverageGroup.replace(/_/g, " ")] : null,
    trace?.itemCount !== undefined ? ["Items", trace.itemCount.toLocaleString()] : null,
    trace?.startPage ? ["Pages", trace.endPage && trace.endPage !== trace.startPage ? `${trace.startPage}-${trace.endPage}` : String(trace.startPage)] : null,
    trace?.sourceBacked !== undefined ? ["Source-backed", trace.sourceBacked ? "yes" : "no"] : null,
  ].filter((row): row is [string, string] => !!row);

  return (
    <div className="space-y-4">
      <OperationalPanel as="section" className="px-3 py-3">
        <dl className="grid gap-x-8 gap-y-2 text-base text-muted-foreground sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Purpose</dt>
            <dd className="ml-2 inline">{details.purpose ?? eventTitle(event)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Task</dt>
            <dd className="ml-2 inline">{[details.task, details.taskKind].filter(Boolean).join(" / ") || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Output</dt>
            <dd className="ml-2 inline">{details.outputKind ?? "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Max tokens</dt>
            <dd className="ml-2 inline">{details.maxOutputTokens?.toLocaleString() ?? "—"}</dd>
          </div>
        </dl>
      </OperationalPanel>
      {inputRows.length ? (
        <OperationalPanel as="section" className="px-3 py-3">
          <h4 className="mb-1.5 text-base font-medium text-muted-foreground">Input attachments</h4>
          <dl className="grid gap-x-8 gap-y-1.5 text-base text-muted-foreground sm:grid-cols-2">
            {inputRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="inline font-medium text-foreground">{label}</dt>
                <dd className="ml-2 inline break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </OperationalPanel>
      ) : null}
      {traceRows.length ? (
        <OperationalPanel as="section" className="px-3 py-3">
          <h4 className="mb-1.5 text-base font-medium text-muted-foreground">Trace metadata</h4>
          <dl className="grid gap-x-8 gap-y-1.5 text-base text-muted-foreground sm:grid-cols-2">
            {traceRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="inline font-medium text-foreground">{label}</dt>
                <dd className="ml-2 inline break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </OperationalPanel>
      ) : null}
      <DebugPreview label="System" value={details.systemPreview} />
      <DebugPreview label="Prompt / input text" value={details.promptPreview} />
      <DebugPreview label="Output" value={details.outputPreview} />
    </div>
  );
}

function TimelineWaterfall({
  rows,
  session,
  labelWidth,
  onLabelWidthChange,
  collapsedIds,
  onToggleCollapsed,
}: {
  rows: TimelineRow[];
  session: TraceRow;
  labelWidth: number;
  onLabelWidthChange: (width: number) => void;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
}) {
  const startAt = session.startedAt;
  const endAt = Math.max(
    session.completedAt ?? 0,
    session.lastEventAt ?? 0,
    ...rows.map((row) => row.endMs),
    startAt + 1,
  );
  const durationMs = Math.max(1, endAt - startAt);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const gridTemplateColumns = `${labelWidth}px minmax(0, 1fr)`;
  const visibleRows = rows.filter((row) => !row.parentId || !collapsedIds.has(row.parentId));

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = labelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(110, Math.min(280, startWidth + moveEvent.clientX - startX));
      onLabelWidthChange(next);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div className="flex h-[70vh] min-h-96 overflow-hidden rounded-lg border border-foreground/6">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize event column"
            onPointerDown={startResize}
            className="absolute top-0 bottom-0 z-20 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12"
            style={{ left: `${labelWidth - 2}px` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid"
            style={{ gridTemplateColumns }}
          >
            <div className="border-r border-foreground/6" />
            <div className="relative min-w-0">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute top-0 h-full border-l border-foreground/6"
                  style={{ left: `${tick * 100}%` }}
                />
              ))}
            </div>
          </div>
          <div className="relative z-10 grid border-b border-foreground/6 bg-muted/20" style={{ gridTemplateColumns }}>
            <div className="px-2.5 py-2 text-label font-medium text-muted-foreground">Event</div>
            <div className="relative h-8 min-w-0 overflow-hidden">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute top-0 ml-1 text-label leading-8 text-muted-foreground"
                  style={{ left: `${tick * 100}%` }}
                >
                  {formatDuration(durationMs * tick)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative z-10 min-h-0 overflow-y-auto">
            <div className="min-h-full">
              {visibleRows.length ? visibleRows.map((row) => {
                const left = ((row.startMs - startAt) / durationMs) * 100;
                const width = Math.max(1.5, (row.durationMs / durationMs) * 100);
                const constrainedLeft = Math.max(0, Math.min(100, left));
                const constrainedWidth = Math.min(100 - constrainedLeft, width);
                const durationLabel = formatDuration(row.durationMs);
                const showDurationInside = constrainedWidth >= 8;
                const showOutsideAfter = constrainedLeft + constrainedWidth <= 88;
                const isCollapsed = collapsedIds.has(row.id);
                const hasChildren = (row.childCount ?? 0) > 0;
                return (
                  <div
                    key={row.id}
                    className="grid min-h-9 border-b border-foreground/6 text-left hover:bg-muted/40"
                    style={{ gridTemplateColumns }}
                  >
                    <div className={`min-w-0 py-1.5 pr-2.5 ${row.level > 0 ? "pl-5" : "pl-2.5"}`}>
                      <div className="flex min-w-0 items-center gap-1">
                        {hasChildren ? (
                          <button
                            type="button"
                            aria-label={isCollapsed ? "Expand timeline row" : "Collapse timeline row"}
                            className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleCollapsed(row.id);
                            }}
                          >
                            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        ) : (
                          <span className="h-4 w-4 shrink-0" />
                        )}
                        <p className="min-w-0 truncate text-label font-medium text-foreground">{row.label}</p>
                      </div>
                      {row.caption ? (
                        <p className="ml-5 mt-0.5 min-w-0 truncate text-label text-muted-foreground">{row.caption}</p>
                      ) : null}
                    </div>
                    <div className="relative min-w-0 overflow-hidden px-0 py-1.5">
                      <div
                        className={`absolute top-1.5 flex h-4 items-center justify-center rounded-sm px-1 ${timelineColor(row.event)}`}
                        style={{
                          left: `${constrainedLeft}%`,
                          width: `${constrainedWidth}%`,
                        }}
                        title={`${row.label} · ${durationLabel} · ${row.caption}`}
                      >
                        {showDurationInside ? (
                          <span className={`truncate text-label font-medium ${timelineInsideTextColor(row.event)}`}>
                            {durationLabel}
                          </span>
                        ) : null}
                      </div>
                      {!showDurationInside ? (
                        <span
                          className="pointer-events-none absolute top-1/2 max-w-14 -translate-y-1/2 truncate px-1 text-label font-medium text-foreground"
                          style={showOutsideAfter
                            ? { left: `${constrainedLeft + constrainedWidth}%` }
                            : { right: `${100 - constrainedLeft}%` }}
                        >
                          {durationLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              }) : (
                <p className="px-3 py-3 text-base text-muted-foreground">No timed events recorded yet.</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-foreground/6 px-3 py-2 text-label text-muted-foreground">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-foreground" />phase</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />model call</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500" />model fallback</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" />model error</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />embedding</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-500" />worker</span>
        </div>
      </div>
    </div>
  );
}

function ModelCallSelector({
  events,
  selectedEventId,
  onSelectEvent,
}: {
  events: TraceEvent[];
  selectedEventId?: string;
  onSelectEvent: (id: string) => void;
}) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-foreground/6 px-3 py-3 text-base text-muted-foreground">
        No model calls recorded.
      </div>
    );
  }
  const selectedEvent = events.find((event) => event._id === selectedEventId) ?? events[0];
  return (
    <div className="space-y-3">
      <OperationalPanel as="section" className="px-3 py-3">
        <Select value={selectedEvent._id} onValueChange={(value) => {
          if (value) onSelectEvent(value);
        }}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue>{modelCallSelectLabel(selectedEvent)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {events.map((event) => (
              <SelectItem key={event._id} value={event._id}>
                {modelCallSelectLabel(event)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </OperationalPanel>
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Model"
          value={[selectedEvent.provider, selectedEvent.model].filter(Boolean).join(" / ") || "—"}
        />
        <OperationalLabelValueRow label="Route" value={[selectedEvent.routeSource, selectedEvent.transport].filter(Boolean).join(" / ") || "—"} />
        <OperationalLabelValueRow label="Route purpose" value={traceEventRoutePurpose(selectedEvent) ?? "—"} />
        <OperationalLabelValueRow label="Status" value={traceEventStatusLabel(selectedEvent) ?? "—"} />
        <OperationalLabelValueRow label="Attempt" value={selectedEvent.attempt ? String(selectedEvent.attempt) : "—"} />
        <OperationalLabelValueRow label="Task" value={selectedEvent.taskKind ?? selectedEvent.task ?? "—"} />
        <OperationalLabelValueRow label="Max tokens" value={traceEventMaxTokens(selectedEvent)?.toLocaleString() ?? "—"} />
        <OperationalLabelValueRow label="Time" value={formatDuration(selectedEvent.durationMs)} />
        <OperationalLabelValueRow
          label="Tokens"
          value={formatTokens(selectedEvent.inputTokens, selectedEvent.outputTokens)}
        />
        {selectedEvent.error ? (
          <OperationalLabelValueRow label="Error" value={selectedEvent.error} />
        ) : null}
      </OperationalLabelValueList>
    </div>
  );
}

function modelCallSelectLabel(event: TraceEvent) {
  return [
    eventTitle(event),
    traceEventAttemptLabel(event),
    traceEventStatusLabel(event),
    formatDuration(event.durationMs),
    formatCompactTokens(event.inputTokens, event.outputTokens) !== "—"
      ? formatCompactTokens(event.inputTokens, event.outputTokens)
      : undefined,
  ].filter(Boolean).join(" · ");
}

export default function OperatorExtractionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const traceIdParam = searchParams.get("traceId");
  const traceTabParam = parseTracePanelTab(searchParams.get("tab"));
  const [status, setStatus] = useState<string>(ALL);
  const [range, setRange] = useState<keyof typeof RANGE_LABELS>("all");
  const [orgId, setOrgId] = useState<string>(ALL);
  const selectedTraceId = traceIdParam;
  const activeTraceTab = traceIdParam ? traceTabParam : "summary";
  const [selectedModelEventId, setSelectedModelEventId] = useState<string | null>(null);
  const [timelineLabelWidth, setTimelineLabelWidth] = useState(150);
  const [collapsedTimelineIds, setCollapsedTimelineIds] = useState<Set<string>>(() => new Set());
  const [rerunningPolicyId, setRerunningPolicyId] = useState<string | null>(null);
  const [stoppingTraceId, setStoppingTraceId] = useState<string | null>(null);
  const rerunExtraction = useAction(api.operator.rerunExtraction);
  const stopExtraction = useMutation(api.operator.stopExtraction);

  const current = useCachedOperatorCurrent();
  const traces = useCachedOperatorExtractionTraces({
    status: status === ALL ? undefined : status as TraceStatus,
    orgId: orgId === ALL ? undefined : orgId,
    range,
    limit: 250,
  }) as TraceRow[] | undefined;
  const detail = useCachedOperatorExtractionTraceDetail(selectedTraceId) as
    | TraceDetail
    | null
    | undefined;

  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const trace of traces ?? []) map.set(trace.orgId, trace.orgName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [traces]);
  const selectedOrgLabel = orgId === ALL
    ? "All orgs"
    : orgOptions.find(([id]) => id === orgId)?.[1] ?? "Selected org";

  const selected = detail?.session ?? traces?.find((trace) => trace.traceId === selectedTraceId) ?? null;
  const selectedPolicyId = selected?.policyId as Id<"policies"> | undefined;
  const isRerunningSelected = !!selectedPolicyId && rerunningPolicyId === selectedPolicyId;
  const isStoppingSelected = !!selectedTraceId && stoppingTraceId === selectedTraceId;
  const selectedIsRunning = selected?.status === "running";
  const modelEvents = (detail?.events ?? []).filter((event) => event.kind === "model_call");
  const selectedModelEvent = modelEvents.find((event) => event._id === selectedModelEventId) ?? modelEvents[0];
  const logEvents = (detail?.events ?? []).filter((event) => event.kind === "log");
  const timelineRows = selected && detail?.events ? buildTimelineRows(detail.events, selected) : [];
  const updateTraceUrl = useCallback((traceId: string | null, tab: TracePanelTab) => {
    const next = new URLSearchParams(searchParams.toString());
    if (traceId) {
      next.set("traceId", traceId);
      next.set("tab", tab);
    } else {
      next.delete("traceId");
      next.delete("tab");
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  const resetTraceLocalState = useCallback(() => {
    setSelectedModelEventId(null);
    setCollapsedTimelineIds(new Set());
  }, []);
  const openTrace = useCallback((traceId: string, tab: TracePanelTab = "summary") => {
    resetTraceLocalState();
    updateTraceUrl(traceId, tab);
  }, [resetTraceLocalState, updateTraceUrl]);
  const closeTrace = useCallback(() => {
    resetTraceLocalState();
    updateTraceUrl(null, "summary");
  }, [resetTraceLocalState, updateTraceUrl]);
  const selectTraceTab = useCallback((tab: TracePanelTab) => {
    if (selectedTraceId) updateTraceUrl(selectedTraceId, tab);
  }, [selectedTraceId, updateTraceUrl]);
  const copyExtractionId = useCallback((traceId: string) => {
    void navigator.clipboard
      .writeText(traceId)
      .then(() => toast.success("Extraction ID copied"))
      .catch(() => toast.error("Couldn't copy extraction ID"));
  }, []);
  const rerunSelectedExtraction = useCallback(async () => {
    if (!selectedPolicyId) return;
    setRerunningPolicyId(selectedPolicyId);
    try {
      const result = await rerunExtraction({ policyId: selectedPolicyId });
      toast.success("Extraction rerun started");
      if (result?.traceId) {
        openTrace(result.traceId, "summary");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rerun extraction");
    } finally {
      setRerunningPolicyId(null);
    }
  }, [openTrace, rerunExtraction, selectedPolicyId]);
  const stopSelectedExtraction = useCallback(async () => {
    if (!selectedTraceId) return;
    setStoppingTraceId(selectedTraceId);
    try {
      const result = await stopExtraction({ traceId: selectedTraceId });
      toast.success(result?.stopped ? "Extraction stopped" : "Extraction was already stopped");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop extraction");
    } finally {
      setStoppingTraceId(null);
    }
  }, [selectedTraceId, stopExtraction]);
  const toggleTimelineCollapsed = useCallback((id: string) => {
    setCollapsedTimelineIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filters = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select value={status} onValueChange={(value) => setStatus(value ?? ALL)}>
        <SelectTrigger size="sm" className="w-full sm:w-36">
          <SelectValue>{STATUS_LABELS[status] ?? status}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="complete">Complete</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>
      <Select value={range} onValueChange={(value) => {
        if (value && value in RANGE_LABELS) setRange(value as keyof typeof RANGE_LABELS);
      }}>
        <SelectTrigger size="sm" className="w-full sm:w-32">
          <SelectValue>{RANGE_LABELS[range]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All time</SelectItem>
          <SelectItem value="24h">24 hours</SelectItem>
          <SelectItem value="30d">30 days</SelectItem>
          <SelectItem value="90d">90 days</SelectItem>
        </SelectContent>
      </Select>
      <Select value={orgId} onValueChange={(value) => setOrgId(value ?? ALL)}>
        <SelectTrigger size="sm" className="w-full sm:w-56">
          <SelectValue>{selectedOrgLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All orgs</SelectItem>
          {orgOptions.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const rightPanel = (
    <SettingsDrawer
      open={!!selectedTraceId}
      onOpenChange={(open) => {
        if (!open) closeTrace();
      }}
      title={selected ? traceDisplayTitle(selected) : "Extraction trace"}
      footer={selected ? (
        <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            className="w-full sm:w-auto"
            disabled={!selectedTraceId || !selectedIsRunning || isStoppingSelected}
            onClick={stopSelectedExtraction}
          >
            {isStoppingSelected ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Stop
          </PillButton>
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            className="w-full sm:w-auto"
            disabled={!selectedPolicyId || selectedIsRunning || isRerunningSelected || isStoppingSelected}
            onClick={rerunSelectedExtraction}
          >
            {isRerunningSelected ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Rerun
          </PillButton>
        </div>
      ) : undefined}
    >
      {detail === undefined && selectedTraceId ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : selected ? (
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
          <Tabs
            value={activeTraceTab}
            onValueChange={(value) => selectTraceTab(parseTracePanelTab(value))}
            className="min-h-full"
          >
            <div className="sticky top-0 z-10 flex shrink-0 items-center bg-background pb-3">
              <TabsList variant="pill" className="scrollbar-hide max-w-full overflow-x-auto py-1">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="extracted">Extracted data</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="models">Model calls</TabsTrigger>
                <TabsTrigger value="log">Log</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="summary" className="pt-1">
              <div className="space-y-3">
                {detail?.eventsTruncated ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-base text-amber-700 dark:text-amber-300">
                    This trace is large, so operator detail is showing a capped event snapshot.
                  </div>
                ) : null}
                <OperationalLabelValueList>
                  <OperationalLabelValueRow
                    label="Extraction ID"
                    value={(
                      <div className="flex min-w-0 items-center gap-2">
                        <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-label">
                          {selected.traceId}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Copy extraction ID"
                          onClick={() => copyExtractionId(selected.traceId)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  />
                  <OperationalLabelValueRow label="Org" value={selected.orgName} />
                  <OperationalLabelValueRow label="File" value={traceDisplayFile(selected)} />
                  <OperationalLabelValueRow label="Status" value={<Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>} />
                  <OperationalLabelValueRow label="Started" value={dayjs(selected.startedAt).format("MMM D, h:mm:ss A")} />
                  <OperationalLabelValueRow label="Duration" value={formatDuration(selected.totalDurationMs ?? (selected.lastEventAt ? selected.lastEventAt - selected.startedAt : undefined))} />
                  <OperationalLabelValueRow label="Model time" value={formatDuration(selected.modelDurationMs)} />
                  <OperationalLabelValueRow label="Tokens" value={formatTokens(selected.inputTokens, selected.outputTokens)} />
                  <OperationalLabelValueRow label="Slowest" value={selected.slowestLabel ? `${selected.slowestLabel} · ${formatDuration(selected.slowestDurationMs)}` : "—"} />
                  {selected.error ? <OperationalLabelValueRow label="Error" value={<span className="text-destructive">{selected.error}</span>} /> : null}
                </OperationalLabelValueList>
                {!selectedIsRunning ? (
                  <OperationalProfileSummary
                    policy={detail?.policy}
                    policyId={selectedPolicyId}
                    fileUrl={detail?.fileUrl ?? undefined}
                    allowOperatorSourceAccess
                  />
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="extracted" className="pt-1">
              {selectedIsRunning ? (
                <div className="rounded-lg border border-foreground/6 px-3 py-3 text-base text-muted-foreground">
                  Extraction is running. Extracted policy data will appear after this run completes.
                </div>
              ) : detail?.policy ? (
                <OperationalProfileSummary
                  policy={detail.policy}
                  policyId={selected.policyId as Id<"policies">}
                  fileUrl={detail.fileUrl ?? undefined}
                  allowOperatorSourceAccess
                />
              ) : (
                <div className="rounded-lg border border-foreground/6 px-3 py-3 text-base text-muted-foreground">
                  Extracted policy data is unavailable for this trace.
                </div>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="pt-1">
              <TimelineWaterfall
                rows={timelineRows}
                session={selected}
                labelWidth={timelineLabelWidth}
                onLabelWidthChange={setTimelineLabelWidth}
                collapsedIds={collapsedTimelineIds}
                onToggleCollapsed={toggleTimelineCollapsed}
              />
            </TabsContent>

            <TabsContent value="models" className="min-w-0 space-y-4 pt-1">
              <ModelCallSelector
                events={modelEvents}
                selectedEventId={selectedModelEvent?._id}
                onSelectEvent={setSelectedModelEventId}
              />
              <ModelCallDebugPanel event={selectedModelEvent} />
            </TabsContent>

            <TabsContent value="log" className="space-y-2 pt-1">
              <div className="rounded-lg border border-foreground/6">
                {logEvents.length ? logEvents.map((event) => (
                  <div key={event._id} className="border-b border-foreground/6 px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-label text-muted-foreground">
                        {dayjs(event.timestamp).format("h:mm:ss A")}{event.phase ? ` · ${event.phase}` : ""}
                      </p>
                      {event.level && event.level !== "info" ? <Badge variant={event.level === "error" ? "destructive" : "secondary"}>{event.level}</Badge> : null}
                    </div>
                    <p className="mt-1 text-base text-foreground">{event.message}</p>
                  </div>
                )) : (
                  <p className="px-3 py-3 text-base text-muted-foreground">No log messages recorded.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="text-base text-muted-foreground">Trace not found.</p>
      )}
    </SettingsDrawer>
  );

  return (
    <AppShell
      breadcrumbDetail="Extractions"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="extractions"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col gap-3">
        {filters}
        <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[13%] px-4 text-label text-muted-foreground">Started</TableHead>
                <TableHead className="w-[16%] text-label text-muted-foreground">Org</TableHead>
                <TableHead className="w-[22%] text-label text-muted-foreground">Policy / file</TableHead>
                <TableHead className="w-[9%] text-label text-muted-foreground">Status</TableHead>
                <TableHead className="w-[9%] text-label text-muted-foreground">Duration</TableHead>
                <TableHead className="w-[15%] text-label text-muted-foreground">Slowest area</TableHead>
                <TableHead className="w-[8%] text-label text-muted-foreground">Calls</TableHead>
                <TableHead className="w-[8%] px-4 text-label text-muted-foreground">Model time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-32 px-4 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    <p className="text-base">Loading extraction traces...</p>
                  </TableCell>
                </TableRow>
              ) : traces.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-32 px-4 text-base text-muted-foreground">
                    No extraction traces yet. Run a policy extraction and traces will appear here.
                  </TableCell>
                </TableRow>
              ) : (
                traces.map((trace) => (
                  <TableRow
                    key={trace.traceId}
                    tabIndex={0}
                    onClick={() => openTrace(trace.traceId)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openTrace(trace.traceId);
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedTraceId === trace.traceId ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4 text-muted-foreground">
                      {dayjs(trace.startedAt).format("MMM D, h:mm A")}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-foreground">{trace.orgName}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-foreground">{traceDisplayTitle(trace)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(trace.status)}>{trace.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDuration(trace.totalDurationMs ?? (trace.lastEventAt ? trace.lastEventAt - trace.startedAt : undefined))}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {trace.slowestLabel ? `${trace.slowestLabel} · ${formatDuration(trace.slowestDurationMs)}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{trace.modelCallCount ?? 0}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{formatDuration(trace.modelDurationMs)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </main>
    </AppShell>
  );
}
