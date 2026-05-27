"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useAction } from "convex/react";
import type { AddressAutofillRetrieveResponse } from "@mapbox/search-js-core";
import type { Theme as MapboxSearchTheme } from "@mapbox/search-js-web";
import dynamic from "next/dynamic";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import {
  BadgeCheck,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RotateCw,
  Send,
  Trash2,
  Eye,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
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

import { PolicySummary } from "./policy-summary";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import {
  useCachedPolicyDetail,
  useCachedPolicySummary,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import {
  PolicyChangeProgress,
  formatPolicyChangeStatus,
  isPolicyChangeTerminal,
} from "@/components/policy-change-progress";
import { PolicyDetailSkeleton } from "./policy-detail-skeleton";

const AddressAutofill = dynamic(
  () =>
    import("@mapbox/search-js-react").then((module) => ({
      default: module.AddressAutofill,
    })),
  { ssr: false },
);

const ExtractionCards = dynamic(
  () =>
    import("./extraction-panel").then((module) => ({
      default: module.ExtractionCards,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    ),
  },
);

dayjs.extend(customParseFormat);

type PolicyAuditLogEntry = {
  _id: string;
  _creationTime: number;
  policyId?: string;
  quoteId?: string;
  userId?: string;
  orgId?: string;
  action: string;
  detail?: string;
  metadata?: unknown;
};

type PolicyPipelineLogEntry = LogEntry & {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

type EditableCoverage = {
  name: string;
  limit?: string;
  limitAmount?: number;
  deductible?: string;
  deductibleAmount?: number;
  coverageCode?: string;
  originalContent?: string;
};

type EditablePremiumLine = {
  line: string;
  amount: string;
  amountValue?: number;
};

type EditableTaxFee = {
  name: string;
  amount: string;
  amountValue?: number;
  type?: string;
  description?: string;
};

type CoverageReviewOption = {
  id?: string;
  value?: string;
  label?: string;
  detail?: string;
  limitType?: string;
  pageNumber?: number;
  sourceLabel?: string;
  reason?: string;
  coverage?: Record<string, unknown>;
};

type CoverageReviewQuestion = {
  id?: string;
  status?: "open" | "confirmed" | "broker_help_requested" | "dismissed";
  coverageName?: string;
  currentValue?: string;
  recommendedOptionId?: string;
  recommendation?: string;
  question?: string;
  reason?: string;
  options?: CoverageReviewOption[];
};

type PolicyDetailTab =
  | "details"
  | "review"
  | "extraction"
  | "certificates"
  | "changes";

function parsePolicyDetailTab(value: string | null): PolicyDetailTab {
  if (
    value === "review" ||
    value === "extraction" ||
    value === "certificates" ||
    value === "changes"
  ) {
    return value;
  }
  return "details";
}

const LOG_POLICY_ACTIVITY_IN_BROWSER =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "development";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const MAPBOX_ADDRESS_AUTOFILL_THEME = {
  variables: {
    unit: "14px",
    minWidth: "min(388px, calc(100vw - 32px))",
    spacing: "0",
    padding: "8px",
    paddingFooterLabel: "8px 10px",
    colorText: "var(--popover-foreground)",
    colorPrimary: "var(--primary)",
    colorSecondary: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorBackgroundHover: "var(--accent)",
    colorBackgroundActive: "var(--secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
    fontFamily: "inherit",
    fontWeight: "400",
    fontWeightSemibold: "500",
    fontWeightBold: "500",
    lineHeight: "1.35",
  },
  cssText: `
    .MapboxSearchListbox {
      overflow: hidden;
    }

    .MapboxSearchListbox * {
      letter-spacing: 0;
    }
  `,
} satisfies MapboxSearchTheme;

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function logPolicyActivityToBrowser(
  event: "status" | "audit" | "pipeline_log",
  payload: Record<string, unknown>,
) {
  if (!LOG_POLICY_ACTIVITY_IN_BROWSER) return;
  console.info(`[policy-activity] ${event}`, payload);
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

function normalizeUsState(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_ABBREVIATIONS[trimmed.toLowerCase()] ?? trimmed;
}

function firstMapboxAddressFeature(response: AddressAutofillRetrieveResponse) {
  return response.features[0]?.properties;
}

function parseMoneyInput(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : undefined;
}

function formatMoneyInput(value: unknown) {
  const amount = parseMoneyInput(value);
  if (amount === undefined) return stringValue(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeDateInput(value: unknown) {
  const raw = stringValue(value);
  if (!raw || raw.toLowerCase() === "unknown") return "";
  const parsed = dayjs(
    raw,
    [
      "YYYY-MM-DD",
      "MM/DD/YYYY",
      "M/D/YYYY",
      "YYYY/M/D",
      "MMM D, YYYY",
      "MMMM D, YYYY",
    ],
    true,
  );
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
}

function dateValueFromInput(value: string) {
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : "";
}

function normalizeCoverageRows(value: unknown): EditableCoverage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        ...row,
        name: stringValue(row.name),
        limit: stringValue(row.limit) || undefined,
        limitAmount:
          typeof row.limitAmount === "number"
            ? row.limitAmount
            : parseMoneyInput(row.limit),
        deductible: stringValue(row.deductible) || undefined,
        deductibleAmount:
          typeof row.deductibleAmount === "number"
            ? row.deductibleAmount
            : parseMoneyInput(row.deductible),
        coverageCode: stringValue(row.coverageCode) || undefined,
        originalContent: stringValue(row.originalContent) || undefined,
      };
    })
    .filter((row) => row.name.trim());
}

function normalizePremiumRows(value: unknown): EditablePremiumLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        line: stringValue(row.line),
        amount: stringValue(row.amount),
        amountValue:
          typeof row.amountValue === "number"
            ? row.amountValue
            : parseMoneyInput(row.amount),
      };
    })
    .filter((row) => row.line.trim() || row.amount.trim());
}

function normalizeTaxRows(value: unknown): EditableTaxFee[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: stringValue(row.name),
        amount: stringValue(row.amount),
        amountValue:
          typeof row.amountValue === "number"
            ? row.amountValue
            : parseMoneyInput(row.amount),
        type: stringValue(row.type) || undefined,
        description: stringValue(row.description) || undefined,
      };
    })
    .filter((row) => row.name.trim() || row.amount.trim());
}

function extractionReviewQuestions(
  policy: Record<string, unknown>,
): CoverageReviewQuestion[] {
  const review = policy.extractionReview as
    | { questions?: CoverageReviewQuestion[] }
    | undefined;
  if (!Array.isArray(review?.questions)) return [];
  return review.questions.filter(
    (question) =>
      question.id &&
      question.status !== "confirmed" &&
      question.status !== "dismissed",
  );
}

function reviewString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatReviewLimitType(value: unknown) {
  const raw = reviewString(value).replace(/_/g, " ");
  if (!raw || raw === "limit") return "";
  if (raw === "per claim") return "per occurrence";
  return raw;
}

function normalizedReviewText(value: unknown) {
  return reviewString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function optionTermKind(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const text = normalizedReviewText(
    [
      option.label,
      option.value,
      option.detail,
      coverage.name,
      coverage.limit,
      coverage.deductible,
      coverage.originalContent,
      coverage.resolvedOriginalContent,
      coverage.sectionRef,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (text.includes("retroactive")) return "retroactive date";
  if (text.includes("deductible") || text.includes("retention"))
    return "deductible";
  return "limit";
}

function optionDetailParts(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const source =
    reviewString(option.sourceLabel) ||
    [
      reviewString(coverage.sectionRef) || reviewString(coverage.formNumber),
      typeof option.pageNumber === "number"
        ? `page ${option.pageNumber}`
        : typeof coverage.pageNumber === "number"
          ? `page ${coverage.pageNumber}`
          : "",
    ]
      .filter(Boolean)
      .join(", ");
  const type = formatReviewLimitType(option.limitType ?? coverage.limitType);
  const name = reviewString(coverage.name);
  const text = reviewString(coverage.originalContent);
  return {
    source,
    type,
    name,
    text,
    detail: reviewString(option.detail),
    reason: reviewString(option.reason),
  };
}

function optionDisplayLabel(option: CoverageReviewOption) {
  const value = reviewString(option.value ?? option.label) || "As stated";
  const label = reviewString(option.label);
  if (label && label !== value) return label;
  const type = formatReviewLimitType(
    option.limitType ?? option.coverage?.limitType,
  );
  if (
    type &&
    !normalizedReviewText(value).includes(normalizedReviewText(type))
  ) {
    return `${value} ${type}`;
  }
  return value;
}

function optionValue(option: CoverageReviewOption) {
  return reviewString(option.value ?? option.label) || "As stated";
}

function optionKey(option: CoverageReviewOption, index: number) {
  return option.id ?? `${optionValue(option)}:${index}`;
}

function optionEvidenceScore(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const text = normalizedReviewText(
    [
      option.sourceLabel,
      option.reason,
      option.detail,
      coverage.sectionRef,
      coverage.formNumber,
      coverage.originalContent,
      coverage.resolvedOriginalContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
  let score = 0;
  if (optionTermKind(option) === "limit") score += 8;
  if (text.includes("item 6") || text.includes("declarations")) score += 5;
  if (text.includes("schedule")) score += 3;
  if (text.includes("source span") || text.includes("evidence")) score += 1;
  if (text.includes("deductible") || text.includes("retroactive")) score -= 10;
  return score;
}

function recommendedOption(
  question: CoverageReviewQuestion,
  options: CoverageReviewOption[],
) {
  if (question.recommendedOptionId) {
    const explicit = options.find(
      (option) => option.id === question.recommendedOptionId,
    );
    if (explicit) return explicit;
  }
  const current = options
    .filter((option) => option.value === question.currentValue)
    .sort((a, b) => optionEvidenceScore(b) - optionEvidenceScore(a))[0];
  if (current) return current;
  return [...options].sort(
    (a, b) => optionEvidenceScore(b) - optionEvidenceScore(a),
  )[0];
}

function recommendationText(
  question: CoverageReviewQuestion,
  option?: CoverageReviewOption,
) {
  if (question.recommendation) return question.recommendation;
  if (!option) return "";
  const details = optionDetailParts(option);
  if (details.source) return `Recommended from ${details.source}.`;
  if (details.reason) return `Recommended because ${details.reason}.`;
  return "Recommended by source evidence.";
}

function displayReviewQuestion(question: CoverageReviewQuestion) {
  const text = reviewString(question.question);
  if (
    text &&
    !/limit\s+limit/i.test(text) &&
    !/applies to this policy/i.test(text)
  ) {
    return text;
  }
  const coverageName = reviewString(question.coverageName)
    .replace(/\s+[-—]\s+.*?(?:limit|deductible|retroactive\s+date)$/i, "")
    .replace(
      /\s+(each\s+claim|per\s+claim|each\s+occurrence|per\s+occurrence|each\s+loss|aggregate|policy\s+aggregate)(?:\s+limit)?$/i,
      "",
    )
    .trim();
  const type = formatReviewLimitType(question.options?.[0]?.limitType);
  if (coverageName && type)
    return `Review the ${type} limit for ${coverageName}`;
  if (coverageName) return `Review the extracted value for ${coverageName}`;
  return "Review this extracted value";
}

function displayReviewReason(question: CoverageReviewQuestion) {
  const reason = reviewString(question.reason);
  if (!reason || /selected policy limit needs confirmation/i.test(reason)) {
    return "Glass found more than one extracted entry. Confirm the value that should be used in the policy summary.";
  }
  return reason;
}

function PolicyExtractionReview({
  policy,
  readOnly,
  canRequestBrokerHelp,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  readOnly: boolean;
  canRequestBrokerHelp: boolean;
}) {
  const questions = extractionReviewQuestions(policy);
  const answerQuestion = useMutation(api.policies.answerCoverageReviewQuestion);
  const requestBrokerHelp = useMutation(
    api.policies.requestCoverageReviewBrokerHelp,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});

  if (questions.length === 0) return null;

  const confirmAnswer = async (
    questionId: string,
    selectedValue: string,
    selectedOptionId?: string,
  ) => {
    setPendingId(`${questionId}:confirm`);
    try {
      await answerQuestion({
        id: policy._id,
        questionId,
        selectedValue,
        selectedOptionId,
      });
      setSelectedOptions((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      toast.success("Coverage confirmed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not confirm coverage",
      );
    } finally {
      setPendingId(null);
    }
  };

  const askBroker = async (questionId: string) => {
    setPendingId(`${questionId}:broker`);
    try {
      await requestBrokerHelp({
        id: policy._id,
        questionId,
      });
      toast.success("Broker help requested");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not request broker help",
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="mb-6">
      <div className="space-y-3">
        {questions.map((question) => {
          const questionId = question.id!;
          const brokerRequested = question.status === "broker_help_requested";
          const options = Array.isArray(question.options)
            ? question.options
            : [];
          const recommended = recommendedOption(question, options);
          const optionEntries = options
            .map((option, index) => ({ option, key: optionKey(option, index) }))
            .filter(({ option }) => optionValue(option));
          const recommendedEntry = recommended
            ? optionEntries.find(({ option }) => option === recommended)
            : undefined;
          const alternativeEntries = optionEntries.filter(
            ({ option }) => option !== recommended,
          );
          const selectedKey =
            selectedOptions[questionId] ?? recommendedEntry?.key;
          const selectedEntry = optionEntries.find(
            ({ key }) => key === selectedKey,
          );
          const isConfirming = pendingId === `${questionId}:confirm`;
          const optionCards = [
            ...(recommendedEntry
              ? [{ ...recommendedEntry, heading: "Recommended Value" }]
              : []),
            ...alternativeEntries.map((entry) => ({
              ...entry,
              heading: "Other Extracted Entry",
            })),
          ];
          return (
            <div
              key={questionId}
              className="rounded-lg border border-foreground/10 bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium text-foreground">
                    {displayReviewQuestion(question)}
                  </p>
                  <p className="mt-1 max-w-4xl text-label-sm leading-5 text-muted-foreground">
                    {displayReviewReason(question)}
                  </p>
                </div>
                {brokerRequested ? (
                  <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Broker requested
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {optionCards.map(({ option, key, heading }) => {
                  const details = optionDetailParts(option);
                  const selected = selectedKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={readOnly || pendingId !== null}
                      onClick={() =>
                        setSelectedOptions((current) => ({
                          ...current,
                          [questionId]: key,
                        }))
                      }
                      aria-pressed={selected}
                      className={`flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-foreground/30 bg-foreground/[0.03] hover:border-foreground/40 hover:bg-foreground/[0.04]"
                          : "border-foreground/10 bg-background hover:border-foreground/20 hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-label-sm font-medium text-muted-foreground">
                          {heading}
                        </p>
                        <p className="mt-1 text-body-sm font-medium text-foreground">
                          {optionDisplayLabel(option)}
                        </p>
                        {details.source || details.type ? (
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {[details.type, details.source]
                              .filter(Boolean)
                              .join(" | ")}
                          </p>
                        ) : null}
                        {key === recommendedEntry?.key ? (
                          <p className="mt-1 text-label-sm leading-5 text-muted-foreground">
                            {recommendationText(question, option)}
                          </p>
                        ) : details.name ? (
                          <p className="mt-1 text-label-sm leading-5 text-muted-foreground">
                            {details.name}
                          </p>
                        ) : null}
                        {details.text ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                            {details.text}
                          </p>
                        ) : null}
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                        {selected ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : null}
                        {selected ? "Selected" : "Select"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PillButton
                  variant="primary"
                  size="compact"
                  disabled={readOnly || pendingId !== null || !selectedEntry}
                  onClick={() =>
                    selectedEntry
                      ? confirmAnswer(
                          questionId,
                          optionValue(selectedEntry.option),
                          selectedEntry.option.id,
                        )
                      : undefined
                  }
                >
                  {isConfirming ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Confirm Selection
                </PillButton>
                {canRequestBrokerHelp && !brokerRequested && (
                  <PillButton
                    variant="secondary"
                    size="compact"
                    disabled={readOnly || pendingId !== null}
                    onClick={() => askBroker(questionId)}
                  >
                    {pendingId === `${questionId}:broker` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Ask Broker
                  </PillButton>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PolicyBreakdownEditor({
  policy,
  readOnly,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  readOnly: boolean;
}) {
  const updateExtractedFields = useMutation(api.policies.updateExtractedFields);
  const [pendingFields, setPendingFields] = useState<Record<string, unknown>>(
    {},
  );
  const [draft, setDraft] = useState(() => ({
    carrier: stringValue(policy.carrier),
    policyNumber: stringValue(policy.policyNumber),
    insuredName: stringValue(policy.insuredName),
    effectiveDate: stringValue(policy.effectiveDate),
    expirationDate: stringValue(policy.expirationDate),
    premium: stringValue(policy.premium),
    premiumBreakdown: normalizePremiumRows(policy.premiumBreakdown),
    taxesAndFees: normalizeTaxRows(policy.taxesAndFees),
    coverages: normalizeCoverageRows(policy.coverages),
  }));

  const savePolicyFields = useCallback(
    async (args: { id: Id<"policies">; fields: Record<string, unknown> }) => {
      await updateExtractedFields(args);
    },
    [updateExtractedFields],
  );

  const policyFieldAutoSave = useLocalFirstAutoSave({
    mutationName: `policy.updateExtractedFields.${policy._id}`,
    args: {
      id: policy._id,
      fields: pendingFields,
    },
    valueKey: JSON.stringify({ id: policy._id, fields: pendingFields }),
    enabled: !readOnly,
    canSave: !readOnly && Object.keys(pendingFields).length > 0,
    delayMs: 500,
    applyLocal: (store, args) => {
      for (const cacheName of ["policies.get", "policies.getSummary"]) {
        const collection = cachedQueryCollectionFor<Record<
          string,
          unknown
        > | null>(cacheName);
        const argsKey = cachedQueryArgsKey({ id: args.id });
        const current = store.getCollection(collection, argsKey)?.[0]?.value;
        if (!current || typeof current !== "object") continue;
        void store.upsertCollection(collection, argsKey, [
          {
            _id: "result",
            value: {
              ...current,
              ...args.fields,
            },
            updatedAt: dayjs().valueOf(),
          },
        ]);
      }
    },
    flush: savePolicyFields,
    onQueued: () => setPendingFields({}),
    onError: () => toast.error("Failed to save policy fields"),
  });

  const saving = policyFieldAutoSave.saving;

  const saveFields = useCallback(
    (fields: Record<string, unknown>) => {
      if (readOnly) return;
      setPendingFields((current) => ({ ...current, ...fields }));
    },
    [readOnly],
  );

  const setScalar = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    const moneyKey = key === "premium";
    const amount = moneyKey ? parseMoneyInput(value) : undefined;
    saveFields({
      [key]: value,
      ...(key === "premium" && amount !== undefined
        ? { premiumAmount: amount }
        : {}),
    });
  };

  const setDateScalar = (
    key: "effectiveDate" | "expirationDate",
    value: string,
  ) => {
    setScalar(key, dateValueFromInput(value));
  };

  const formatScalarMoney = (key: "premium") => {
    const formatted = formatMoneyInput(draft[key]);
    if (formatted !== draft[key]) setScalar(key, formatted);
  };

  const updatePremiumBreakdown = (next: EditablePremiumLine[]) => {
    const rows = next.filter((row) => row.line.trim() || row.amount.trim());
    setDraft((current) => ({ ...current, premiumBreakdown: next }));
    saveFields({
      premiumBreakdown: rows.map((row) => ({
        line: row.line.trim() || "Premium line",
        amount: row.amount.trim(),
        ...(parseMoneyInput(row.amount) !== undefined
          ? { amountValue: parseMoneyInput(row.amount) }
          : {}),
      })),
    });
  };

  const updateTaxesAndFees = (next: EditableTaxFee[]) => {
    const rows = next.filter((row) => row.name.trim() || row.amount.trim());
    setDraft((current) => ({ ...current, taxesAndFees: next }));
    saveFields({
      taxesAndFees: rows.map((row) => ({
        name: row.name.trim() || "Fee",
        amount: row.amount.trim(),
        ...(parseMoneyInput(row.amount) !== undefined
          ? { amountValue: parseMoneyInput(row.amount) }
          : {}),
        ...(row.type?.trim() ? { type: row.type.trim() } : {}),
        ...(row.description?.trim()
          ? { description: row.description.trim() }
          : {}),
      })),
    });
  };

  const updateCoverages = (next: EditableCoverage[]) => {
    const rows = next.filter((row) => row.name.trim());
    setDraft((current) => ({ ...current, coverages: next }));
    saveFields({
      coverages: rows.map((row) => ({
        ...row,
        name: row.name.trim(),
        ...(row.limit?.trim() ? { limit: row.limit.trim() } : {}),
        ...(parseMoneyInput(row.limit) !== undefined
          ? { limitAmount: parseMoneyInput(row.limit) }
          : {}),
        ...(row.deductible?.trim()
          ? { deductible: row.deductible.trim() }
          : {}),
        ...(parseMoneyInput(row.deductible) !== undefined
          ? { deductibleAmount: parseMoneyInput(row.deductible) }
          : {}),
        ...(row.coverageCode?.trim()
          ? { coverageCode: row.coverageCode.trim() }
          : {}),
        ...(row.originalContent?.trim()
          ? { originalContent: row.originalContent.trim() }
          : {}),
      })),
    });
  };

  if (readOnly) return null;

  const fields = [
    { key: "carrier", label: "Carrier", kind: "text" },
    { key: "policyNumber", label: "Policy number", kind: "text" },
    { key: "insuredName", label: "Named insured", kind: "text" },
    { key: "effectiveDate", label: "Effective date", kind: "date" },
    { key: "expirationDate", label: "Expiration date", kind: "date" },
    { key: "premium", label: "Premium", kind: "money" },
  ] as const;

  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-foreground/4 flex items-center gap-3">
        <p className="text-sm font-medium text-foreground flex-1">
          Editable extracted fields
        </p>
        <span className="text-xs text-muted-foreground">
          {saving ? "Saving..." : "Saved on change"}
        </span>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {fields.map(({ key, label, kind }) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Input
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "money" ? "decimal" : undefined}
                value={
                  kind === "date" ? normalizeDateInput(draft[key]) : draft[key]
                }
                onChange={(event) => {
                  if (kind === "date") {
                    setDateScalar(key, event.target.value);
                    return;
                  }
                  setScalar(key, event.target.value);
                }}
                onBlur={() => {
                  if (kind === "money") formatScalarMoney(key);
                }}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-foreground flex-1">
              Premium breakdown
            </p>
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updatePremiumBreakdown([
                  ...draft.premiumBreakdown,
                  { line: "", amount: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          </div>
          <div className="space-y-2">
            {draft.premiumBreakdown.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2"
              >
                <Input
                  placeholder="Line"
                  value={row.line}
                  onChange={(event) => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = { ...row, line: event.target.value };
                    updatePremiumBreakdown(next);
                  }}
                />
                <Input
                  placeholder="Amount"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = { ...row, amount: event.target.value };
                    updatePremiumBreakdown(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = {
                      ...row,
                      amount: formatMoneyInput(row.amount),
                    };
                    updatePremiumBreakdown(next);
                  }}
                />
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updatePremiumBreakdown(
                      draft.premiumBreakdown.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-foreground flex-1">
              Taxes and fees
            </p>
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updateTaxesAndFees([
                  ...draft.taxesAndFees,
                  { name: "", amount: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          </div>
          <div className="space-y-2">
            {draft.taxesAndFees.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-2"
              >
                <Input
                  placeholder="Name"
                  value={row.name}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, name: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                />
                <Input
                  placeholder="Amount"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, amount: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.taxesAndFees];
                    next[index] = {
                      ...row,
                      amount: formatMoneyInput(row.amount),
                    };
                    updateTaxesAndFees(next);
                  }}
                />
                <Input
                  placeholder="Type"
                  value={row.type ?? ""}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, type: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                />
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updateTaxesAndFees(
                      draft.taxesAndFees.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-foreground flex-1">
              Coverages
            </p>
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updateCoverages([
                  ...draft.coverages,
                  { name: "", limit: "", deductible: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          </div>
          <div className="space-y-2">
            {draft.coverages.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_auto] gap-2"
              >
                <Input
                  placeholder="Coverage"
                  value={row.name}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, name: event.target.value };
                    updateCoverages(next);
                  }}
                />
                <Input
                  placeholder="Limit"
                  inputMode="decimal"
                  value={row.limit ?? ""}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, limit: event.target.value };
                    updateCoverages(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.coverages];
                    next[index] = {
                      ...row,
                      limit: formatMoneyInput(row.limit),
                    };
                    updateCoverages(next);
                  }}
                />
                <Input
                  placeholder="Deductible"
                  inputMode="decimal"
                  value={row.deductible ?? ""}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, deductible: event.target.value };
                    updateCoverages(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.coverages];
                    next[index] = {
                      ...row,
                      deductible: formatMoneyInput(row.deductible),
                    };
                    updateCoverages(next);
                  }}
                />
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updateCoverages(
                      draft.coverages.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type DeclarationDiscrepancy = {
  _id: Id<"declarationDiscrepancies">;
  fieldGroup: string;
  likelyCurrentValue?: string;
  question?: string;
  plainLanguageSummary?: string;
  recommendedAction?: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "notified" | "confirmed" | "dismissed" | "case_created";
  updatedAt: number;
  conflictingValues: Array<{
    displayValue?: string;
    normalizedValue?: string;
    policyLabels?: Array<{ policyId: string; label: string }>;
  }>;
};

function formatDeclarationFieldGroup(fieldGroup: string) {
  const [group, detail] = fieldGroup.split(":", 2);
  const labels: Record<string, string> = {
    insured_identity: "Named insured",
    policy_number: "Policy number",
    carrier: "Insurance company",
    insurer: "Insurer",
    producer: "Producer",
    dba: "DBA",
    entity_type: "Entity type",
    fein: "FEIN",
    mailing_address: "Mailing address",
    scheduled_location: "Location",
    additional_named_insured: "Additional named insured",
    coverage_limit: "Coverage limit",
    coverage_deductible: "Deductible",
  };
  const baseLabel =
    labels[group] ??
    group
      .split("_")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  if (!detail) return baseLabel;
  const detailLabel = detail
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return `${baseLabel}: ${detailLabel}`;
}

function displayDeclarationValue(value: string | undefined) {
  if (!value) return "Needs confirmation";
  return value
    .replace(/: null$/i, ": no value found")
    .replace(/\bnull\b/gi, "no value found")
    .replace(/\bunknown\b/gi, "Unknown");
}

function DeclarationDiscrepancyList({
  discrepancies,
}: {
  discrepancies: DeclarationDiscrepancy[];
}) {
  if (discrepancies.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-500/20 bg-amber-500/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-body-sm font-medium text-foreground">
            Policy details need confirmation
          </h3>
          <p className="mt-1 max-w-3xl text-label-sm leading-5 text-muted-foreground">
            Different active policies show different values. Confirm the
            correct detail before using it on certificates, renewals, or policy
            changes.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          {discrepancies.length} to check
        </span>
      </div>

      <div className="mt-4 divide-y divide-foreground/6 border-t border-foreground/6">
        {discrepancies.map((discrepancy) => (
          <div
            key={discrepancy._id}
            className="py-3 first:pt-3 last:pb-0"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1fr)_minmax(220px,1.4fr)_auto] md:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  Detail
                </p>
                <p className="mt-1 text-label-sm font-medium text-foreground">
                  {discrepancy.question ??
                    formatDeclarationFieldGroup(discrepancy.fieldGroup)}
                </p>
                {discrepancy.plainLanguageSummary && (
                  <p className="mt-1 text-label-sm leading-5 text-muted-foreground">
                    {discrepancy.plainLanguageSummary}
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  Best guess
                </p>
                <p className="mt-1 text-label-sm font-medium text-foreground">
                  {displayDeclarationValue(discrepancy.likelyCurrentValue)}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  Values found
                </p>
                <div className="mt-1 space-y-2">
                  {discrepancy.conflictingValues.map((value, index) => (
                    <div
                      key={`${value.normalizedValue ?? value.displayValue ?? "value"}-${index}`}
                      className="min-w-0"
                    >
                      <p className="break-words text-label-sm font-medium text-foreground">
                        {displayDeclarationValue(
                          value.displayValue ?? value.normalizedValue,
                        )}
                      </p>
                      {value.policyLabels && value.policyLabels.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {value.policyLabels.map((policy) => (
                            <Link
                              key={policy.policyId}
                              href={`/policies/${policy.policyId}`}
                              className="rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {policy.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <span className="justify-self-start rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground md:justify-self-end">
                Updated {dayjs(discrepancy.updatedAt).format("MMM D")}
              </span>
            </div>
            {discrepancy.recommendedAction && (
              <p className="mt-2 text-label-sm leading-5 text-muted-foreground">
                {discrepancy.recommendedAction}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function PolicyChangesTab({
  policyId,
  canManage,
}: {
  policyId: string;
  canManage: boolean;
}) {
  const [selectedCaseId, setSelectedCaseId] =
    useState<Id<"policyChangeCases"> | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const cases = useCachedQuery(
    "policyChanges.listByPolicy",
    api.policyChanges.listByPolicy,
    {
      policyId: policyId as Id<"policies">,
    },
  );
  const declarationDiscrepancies = useCachedQuery(
    "declarationFacts.listForPolicy",
    api.declarationFacts.listForPolicy,
    {
      policyId: policyId as Id<"policies">,
    },
  );
  const activeCaseId = selectedCaseId ?? cases?.[0]?._id ?? null;
  const detail = useCachedQuery(
    "policyChanges.getCaseDetail.policy",
    api.policyChanges.getCaseDetail,
    canManage && activeCaseId ? { caseId: activeCaseId } : "skip",
  );
  const updateCases = useUpdateCachedQuery<
    typeof cases,
    { policyId: Id<"policies"> }
  >("policyChanges.listByPolicy");
  const updateDetail = useUpdateCachedQuery<
    typeof detail,
    { caseId: Id<"policyChangeCases"> }
  >("policyChanges.getCaseDetail.policy");
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);

  if (cases === undefined || declarationDiscrepancies === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="space-y-3">
        <DeclarationDiscrepancyList
          discrepancies={declarationDiscrepancies}
        />
        <div className="rounded-lg border border-foreground/6 bg-card px-4 py-6 text-center">
          <p className="text-body-sm text-muted-foreground">
            No policy change requests recorded yet.
          </p>
        </div>
      </div>
    );
  }

  const handleGeneratePacket = async () => {
    if (!activeCaseId) return;
    setPacketLoading(true);
    try {
      await generatePacket({ caseId: activeCaseId });
      toast.success("Policy change packet generated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate packet",
      );
    } finally {
      setPacketLoading(false);
    }
  };

  const handleStatus = async (
    status: "submitted" | "waiting_for_endorsement" | "completed" | "declined",
  ) => {
    if (!activeCaseId) return;
    setStatusLoading(status);
    try {
      await markStatus({ caseId: activeCaseId, status });
      await Promise.all([
        updateCases({ policyId: policyId as Id<"policies"> }, (current) =>
          current?.map((changeCase) =>
            changeCase._id === activeCaseId
              ? { ...changeCase, status }
              : changeCase,
          ),
        ),
        updateDetail({ caseId: activeCaseId }, (current) =>
          current?.case
            ? {
                ...current,
                case: {
                  ...current.case,
                  status,
                },
              }
            : current,
        ),
      ]);
      toast.success(status === "submitted" ? "Marked sent" : `Marked ${status}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update status",
      );
    } finally {
      setStatusLoading(null);
    }
  };

  const handleCancel = async (caseId: Id<"policyChangeCases">) => {
    setCancelLoading(caseId);
    try {
      await cancelRequest({ caseId });
      await Promise.all([
        updateCases({ policyId: policyId as Id<"policies"> }, (current) =>
          current?.map((changeCase) =>
            changeCase._id === caseId
              ? { ...changeCase, status: "cancelled" }
              : changeCase,
          ),
        ),
        updateDetail({ caseId }, (current) =>
          current?.case
            ? {
                ...current,
                case: {
                  ...current.case,
                  status: "cancelled",
                },
              }
            : current,
        ),
      ]);
      toast.success("Policy change request cancelled");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel request",
      );
    } finally {
      setCancelLoading(null);
    }
  };

  if (!canManage) {
    return (
      <div className="space-y-3">
        <DeclarationDiscrepancyList
          discrepancies={declarationDiscrepancies}
        />
        {cases.map((change) => {
          const missingInfoCount = Array.isArray(change.missingInfoQuestions)
            ? change.missingInfoQuestions.length
            : 0;
          const issueCount = Array.isArray(change.validationIssues)
            ? change.validationIssues.length
            : 0;
          const terminal = isPolicyChangeTerminal(change.status);

          return (
            <div
              key={change._id}
              className="rounded-lg border border-foreground/6 bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-sm font-medium text-foreground">
                      {change.summary ?? "Policy change request"}
                    </p>
                    <span className="rounded-full border border-foreground/8 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {formatPolicyChangeStatus(change.status)}
                    </span>
                  </div>
                  <p className="mt-2 max-w-3xl text-label-sm leading-5 text-muted-foreground">
                    {change.requestText}
                  </p>
                </div>
                {!terminal && (
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleCancel(change._id)}
                    disabled={cancelLoading !== null}
                  >
                    {cancelLoading === change._id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    Cancel
                  </PillButton>
                )}
              </div>

              <PolicyChangeProgress status={change.status} className="mt-4" />

              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>
                  Updated {dayjs(change.updatedAt).format("MMM D, YYYY")}
                </span>
                {missingInfoCount > 0 && (
                  <span>
                    {missingInfoCount} question
                    {missingInfoCount === 1 ? "" : "s"} open
                  </span>
                )}
                {issueCount > 0 && (
                  <span>
                    {issueCount} issue{issueCount === 1 ? "" : "s"} to review
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const activeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = Array.isArray(activeCase?.items)
    ? (activeCase.items as Record<string, unknown>[])
    : [];
  const missingInfo = Array.isArray(activeCase?.missingInfoQuestions)
    ? (activeCase.missingInfoQuestions as Record<string, unknown>[])
    : [];
  const validationIssues = Array.isArray(activeCase?.validationIssues)
    ? (activeCase.validationIssues as Record<string, unknown>[])
    : [];
  const artifacts = Array.isArray(packet?.artifacts)
    ? (packet.artifacts as Record<string, unknown>[])
    : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
      {declarationDiscrepancies.length > 0 && (
        <div className="lg:col-span-2">
          <DeclarationDiscrepancyList
            discrepancies={declarationDiscrepancies}
          />
        </div>
      )}

      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {cases.map((change) => {
          const missingInfoCount = Array.isArray(change.missingInfoQuestions)
            ? change.missingInfoQuestions.length
            : 0;
          const validationIssueCount = Array.isArray(change.validationIssues)
            ? change.validationIssues.length
            : 0;
          const isActive = activeCaseId === change._id;
          return (
            <button
              key={change._id}
              type="button"
              onClick={() => setSelectedCaseId(change._id)}
              className={`block w-full text-left px-4 py-3 border-b border-foreground/[0.04] last:border-b-0 transition-colors ${
                isActive
                  ? "bg-foreground/[0.035]"
                  : "hover:bg-foreground/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground truncate">
                    {change.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label-sm text-muted-foreground line-clamp-2">
                    {change.requestText}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-foreground/8 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {formatPolicyChangeStatus(change.status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{change.sourceKind.replace("_", " ")}</span>
                <span>{dayjs(change.updatedAt).format("MMM D, YYYY")}</span>
                <span>{missingInfoCount} questions</span>
                <span>{validationIssueCount} validation issues</span>
                {(change.evidenceSourceIds?.length ?? 0) > 0 && (
                  <span>{change.evidenceSourceIds!.length} evidence spans</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {detail === undefined ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-48 rounded" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : activeCase ? (
          <div className="divide-y divide-foreground/[0.06]">
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground">
                    {activeCase.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    {activeCase.requestText}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={handleGeneratePacket}
                    disabled={packetLoading}
                  >
                    {packetLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    Packet
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("submitted")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "submitted" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Sent
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("waiting_for_endorsement")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "waiting_for_endorsement" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    Waiting
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("completed")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "completed" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    Complete
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("declined")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "declined" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    Declined
                  </PillButton>
                  {activeCase.status !== "cancelled" &&
                    activeCase.status !== "accepted" &&
                    activeCase.status !== "completed" &&
                    activeCase.status !== "declined" && (
                      <PillButton
                        variant="secondary"
                        size="compact"
                        onClick={() => handleCancel(activeCase._id)}
                        disabled={cancelLoading !== null}
                      >
                        {cancelLoading === activeCase._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        Cancel
                      </PillButton>
                    )}
                </div>
              </div>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">
                  Affected Values
                </h3>
                <div className="mt-2 space-y-2">
                  {items.length > 0 ? (
                    items.map((item, i) => (
                      <div
                        key={String(item.id ?? i)}
                        className="rounded-md border border-foreground/6 p-3"
                      >
                        <p className="text-label-sm font-medium text-foreground">
                          {String(
                            item.label ?? item.fieldPath ?? "Change item",
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {String(item.action ?? "update")} ·{" "}
                          {String(item.kind ?? "general")}
                        </p>
                        <p className="mt-2 text-label-sm text-muted-foreground">
                          {String(item.beforeValue ?? "(not cited)")} →{" "}
                          {String(
                            item.requestedValue ??
                              item.afterValue ??
                              "(pending)",
                          )}
                        </p>
                        {Array.isArray(item.sourceSpanIds) &&
                          item.sourceSpanIds.length > 0 && (
                            <p className="mt-2 text-[11px] text-muted-foreground break-all">
                              evidence: {item.sourceSpanIds.join(", ")}
                            </p>
                          )}
                      </div>
                    ))
                  ) : (
                    <p className="text-label-sm text-muted-foreground">
                      No structured change items yet.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">
                  Validation
                </h3>
                <div className="mt-2 space-y-2">
                  {validationIssues.length > 0 ? (
                    validationIssues.map((issue, i) => (
                      <div
                        key={`${String(issue.code ?? "issue")}-${i}`}
                        className="rounded-md border border-foreground/6 p-3"
                      >
                        <p className="text-label-sm font-medium text-foreground">
                          {String(issue.code ?? "validation issue")}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {String(issue.severity ?? "warning")}
                        </p>
                        <p className="mt-2 text-label-sm text-muted-foreground">
                          {String(issue.message ?? "")}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-label-sm text-muted-foreground">
                      No validation issues recorded.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">
                  Packet Preview
                </h3>
                <div className="mt-2 space-y-2">
                  {artifacts.length > 0 ? (
                    artifacts.map((artifact, i) => (
                      <details
                        key={`${String(artifact.kind ?? "artifact")}-${i}`}
                        className="rounded-md border border-foreground/6 p-3"
                      >
                        <summary className="text-label-sm font-medium text-foreground transition-colors hover:text-muted-foreground">
                          {String(
                            artifact.title ??
                              artifact.kind ??
                              "Packet artifact",
                          )}
                        </summary>
                        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
                          {String(artifact.content ?? "")}
                        </pre>
                      </details>
                    ))
                  ) : (
                    <p className="text-label-sm text-muted-foreground">
                      No generated packet yet.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">
                  Missing Info And Audit
                </h3>
                <div className="mt-2 space-y-3">
                  {missingInfo.length > 0 ? (
                    <div className="space-y-2">
                      {missingInfo.map((question, i) => (
                        <div
                          key={String(question.id ?? i)}
                          className="rounded-md border border-foreground/6 p-3"
                        >
                          <p className="text-label-sm text-foreground">
                            {String(question.question ?? "Missing information")}
                          </p>
                          {question.answer ? (
                            <p className="mt-2 text-label-sm text-muted-foreground">
                              {String(question.answer)}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-label-sm text-muted-foreground">
                      No open missing-info questions.
                    </p>
                  )}
                  <div className="space-y-2">
                    {(detail.messages ?? []).map((message) => (
                      <div
                        key={message._id}
                        className="text-[11px] text-muted-foreground"
                      >
                        {dayjs(message.createdAt).format("MMM D, YYYY h:mm A")}{" "}
                        · {message.direction} · {message.channel ?? "case"} ·{" "}
                        {message.content.slice(0, 140)}
                      </div>
                    ))}
                    {(detail.validationReports ?? []).map((report) => (
                      <div
                        key={report._id}
                        className="text-[11px] text-muted-foreground"
                      >
                        {dayjs(report.createdAt).format("MMM D, YYYY h:mm A")} ·
                        validation {report.status}
                      </div>
                    ))}
                    {(detail.evidenceLinks ?? []).map((link) => (
                      <div
                        key={link._id}
                        className="text-[11px] text-muted-foreground break-all"
                      >
                        evidence · {link.itemId ?? "case"} · {link.sourceSpanId}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ViewPdfButton({
  url,
  disabled = false,
}: {
  url?: string | null;
  disabled?: boolean;
}) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="icon"
      size="compact"
      label={isPdfOpen ? "Hide PDF" : "View PDF"}
      disabled={disabled}
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="size-4 shrink-0" />
    </PillButton>
  );
}

function formatCertificateTimestamp(value: number) {
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

type ProgramMatchCandidate = {
  programId?: Id<"partnerPrograms">;
  programName?: string;
  _id?: Id<"partnerPrograms">;
  name?: string;
  categoryLabels?: string[];
  approvalMode?: string;
  score?: number;
};

const CERTIFICATE_ENDORSEMENT_OPTIONS = [
  { value: "additional_insured", label: "Additional insured" },
  { value: "waiver_of_subrogation", label: "Waiver" },
  { value: "primary_non_contributory", label: "Primary/non-contributory" },
  { value: "loss_payee", label: "Loss payee" },
  { value: "mortgagee", label: "Mortgagee" },
];

function normalizeProgramMatchCandidate(candidate: ProgramMatchCandidate) {
  const programId = candidate.programId ?? candidate._id;
  if (!programId) return null;
  return {
    ...candidate,
    programId,
    programName: candidate.programName ?? candidate.name ?? "Program",
  };
}

function CertificateCreatePanel({
  open,
  onOpenChange,
  policyId,
  initialProgram,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: Id<"policies">;
  initialProgram?: ProgramMatchCandidate | null;
}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const previewCertificateAuthority = useAction(
    api.certificates.previewAuthorityForPolicy,
  );
  const { openWithUrl } = usePdf();
  const initialProgramCandidate = useMemo(
    () => normalizeProgramMatchCandidate(initialProgram ?? {}),
    [initialProgram],
  );
  const [holderName, setHolderName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [selectedPartnerProgramId, setSelectedPartnerProgramId] = useState<
    Id<"partnerPrograms"> | undefined
  >(initialProgramCandidate?.programId);
  const [requestedEndorsements, setRequestedEndorsements] = useState<string[]>(
    [],
  );
  const [programCandidates, setProgramCandidates] = useState<
    ProgramMatchCandidate[]
  >(() => (initialProgramCandidate ? [initialProgramCandidate] : []));
  const [resolvingProgram, setResolvingProgram] = useState(false);
  const [generating, setGenerating] = useState(false);

  const reset = () => {
    setHolderName("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setState("");
    setPostalCode("");
    setRequestedEndorsements([]);
    setSelectedPartnerProgramId(initialProgramCandidate?.programId);
    setProgramCandidates(
      initialProgramCandidate ? [initialProgramCandidate] : [],
    );
    setResolvingProgram(false);
  };

  const handleAddressRetrieve = useCallback(
    (response: AddressAutofillRetrieveResponse) => {
      const address = firstMapboxAddressFeature(response);
      if (!address) return;

      const nextAddressLine1 =
        address.address_line1 ?? address.address ?? address.feature_name ?? "";
      const nextAddressLine2 = address.address_line2 ?? "";
      const nextCity = address.address_level2 ?? address.address_level3 ?? "";
      const nextState = normalizeUsState(address.address_level1);
      const nextPostalCode = address.postcode ?? "";

      if (nextAddressLine1) setAddressLine1(nextAddressLine1);
      setAddressLine2(nextAddressLine2);
      if (nextCity) setCity(nextCity);
      if (nextState) setState(nextState);
      if (nextPostalCode) setPostalCode(nextPostalCode);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    if (initialProgramCandidate) return;
    let cancelled = false;

    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setResolvingProgram(true);
        setSelectedPartnerProgramId(undefined);
        setProgramCandidates([]);
        return previewCertificateAuthority({ policyId });
      })
      .then((result) => {
        if (cancelled || !result) return;
        const selectedProgram = normalizeProgramMatchCandidate(
          (result as { selectedProgram?: ProgramMatchCandidate | null })
            .selectedProgram ?? {},
        );
        const candidates = (
          (result as { matchCandidates?: ProgramMatchCandidate[] })
            .matchCandidates ?? []
        )
          .map(normalizeProgramMatchCandidate)
          .filter(Boolean) as Array<
          ProgramMatchCandidate & {
            programId: Id<"partnerPrograms">;
            programName: string;
          }
        >;
        const nextCandidates = selectedProgram ? [selectedProgram] : candidates;
        setProgramCandidates(nextCandidates);
        setSelectedPartnerProgramId(nextCandidates[0]?.programId);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not check certificate program",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setResolvingProgram(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialProgramCandidate, open, policyId, previewCertificateAuthority]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!holderName.trim()) {
      toast.error("Certificate holder is required");
      return;
    }

    setGenerating(true);
    try {
      const result = await generateCertificate({
        policyId,
        holderName: holderName.trim(),
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        selectedPartnerProgramId,
        requestedEndorsements:
          requestedEndorsements.length > 0 ? requestedEndorsements : undefined,
        requestText:
          requestedEndorsements.length > 0
            ? `Generate certificate for ${holderName.trim()} with ${requestedEndorsements.join(", ")}.`
            : undefined,
      });
      if ((result as { status?: string }).status === "pending_approval") {
        toast.success("Certified COI sent for program administrator approval");
        onOpenChange(false);
        reset();
        return;
      }
      if (
        (result as { status?: string }).status ===
        "held_policy_change_required"
      ) {
        toast.message(
          (result as { message?: string }).message ??
            "Certificate request is on hold for broker review",
        );
        onOpenChange(false);
        reset();
        return;
      }
      if (
        (result as { status?: string }).status === "needs_program_selection"
      ) {
        const candidates = (
          (result as { matchCandidates?: ProgramMatchCandidate[] })
            .matchCandidates ?? []
        )
          .map(normalizeProgramMatchCandidate)
          .filter(Boolean) as Array<
          ProgramMatchCandidate & {
            programId: Id<"partnerPrograms">;
            programName: string;
          }
        >;
        setProgramCandidates(candidates);
        setSelectedPartnerProgramId(candidates[0]?.programId);
        toast.message(
          "Confirm the correct program before generating this certified COI",
        );
        return;
      }
      toast.success(
        (result as { authorityType?: string }).authorityType === "certified"
          ? "Certified certificate generated"
          : "Non-binding certificate generated",
      );
      onOpenChange(false);
      reset();
      if (result.url) openWithUrl(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not generate certificate",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (generating) return;
        onOpenChange(value);
        if (!value) reset();
      }}
      title="Generate COI"
      footer={
        <>
          <PillButton
            variant="secondary"
            size="compact"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </PillButton>
          <PillButton
            type="submit"
            form="certificate-create-form"
            size="compact"
            disabled={generating || resolvingProgram || !holderName.trim()}
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BadgeCheck className="w-3.5 h-3.5" />
            )}
            Generate
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-body-sm text-muted-foreground">
          Create a certificate from this policy and list the certificate holder
          on the PDF.
        </p>

        <form
          id="certificate-create-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {resolvingProgram || programCandidates.length > 0 ? (
            <div className="rounded-lg border border-foreground/8 bg-card p-3">
              <p className="text-body-sm font-medium text-foreground">
                {programCandidates.length > 1 ? "Choose program" : "Program"}
              </p>
              <div className="mt-3 grid gap-2">
                {resolvingProgram ? (
                  <div className="rounded-md border border-foreground/8 px-3 py-2">
                    <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Checking policy program...
                    </div>
                  </div>
                ) : (
                  programCandidates.map((candidate) => {
                    const selected =
                      selectedPartnerProgramId === candidate.programId;
                    return (
                      <button
                        key={candidate.programId}
                        type="button"
                        className={`rounded-md border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-foreground/30 bg-foreground/5"
                            : "border-foreground/8 hover:bg-foreground/[0.03]"
                        }`}
                        onClick={() =>
                          setSelectedPartnerProgramId(candidate.programId)
                        }
                        disabled={generating}
                        aria-pressed={selected}
                      >
                        <span className="block text-body-sm font-medium text-foreground">
                          {candidate.programName}
                        </span>
                        <span className="mt-0.5 block text-label-sm text-muted-foreground/70">
                          {[
                            candidate.categoryLabels?.join(", "),
                            candidate.approvalMode,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Program administrator program"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="certificate-holder-name">Certificate holder</Label>
            <Input
              id="certificate-holder-name"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder="Company or individual name"
              autoComplete="organization"
              autoFocus
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-1">Address line 1</Label>
            {MAPBOX_ACCESS_TOKEN ? (
              <AddressAutofill
                accessToken={MAPBOX_ACCESS_TOKEN}
                options={{ country: "US", language: "en", proximity: "ip" }}
                theme={MAPBOX_ADDRESS_AUTOFILL_THEME}
                popoverOptions={{
                  placement: "bottom-start",
                  flip: true,
                  offset: 6,
                }}
                onRetrieve={handleAddressRetrieve}
              >
                <Input
                  id="certificate-address-1"
                  value={addressLine1}
                  onChange={(event) => setAddressLine1(event.target.value)}
                  placeholder="Street address"
                  autoComplete="section-certificate address-line1"
                  disabled={generating}
                />
              </AddressAutofill>
            ) : (
              <Input
                id="certificate-address-1"
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
                placeholder="Street address"
                autoComplete="section-certificate address-line1"
                disabled={generating}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-2">Address line 2</Label>
            <Input
              id="certificate-address-2"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              placeholder="Suite, floor, attention line"
              autoComplete="section-certificate address-line2"
              disabled={generating}
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="certificate-city">City</Label>
              <Input
                id="certificate-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoComplete="section-certificate address-level2"
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-state">State</Label>
              <Input
                id="certificate-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                autoComplete="section-certificate address-level1"
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-postal-code">ZIP</Label>
              <Input
                id="certificate-postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                autoComplete="section-certificate postal-code"
                disabled={generating}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Requested endorsements</Label>
            <div className="flex flex-wrap gap-2">
              {CERTIFICATE_ENDORSEMENT_OPTIONS.map((option) => {
                const selected = requestedEndorsements.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={generating}
                    onClick={() =>
                      setRequestedEndorsements((current) =>
                        selected
                          ? current.filter((value) => value !== option.value)
                          : [...current, option.value],
                      )
                    }
                    className={`rounded-md border px-2.5 py-1.5 text-label-sm capitalize transition-colors ${
                      selected
                        ? "border-foreground/25 bg-foreground/[0.04] text-foreground"
                        : "border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-label-sm text-muted-foreground/60">
              Endorsement-bearing requests are checked against policy wording
              before Glass issues a certificate.
            </p>
          </div>
        </form>
      </div>
    </SettingsDrawer>
  );
}

function CertificatesTab({ policyId }: { policyId: Id<"policies"> }) {
  const activity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId },
  );
  const { openWithUrl } = usePdf();

  if (activity === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const rows = [
    ...((activity.certificates ?? []) as Array<Record<string, unknown>>),
    ...((activity.holds ?? []) as Array<Record<string, unknown>>),
  ].sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card px-4 py-8 text-center">
        <BadgeCheck className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
        <p className="text-body-sm font-medium text-foreground">
          No certificates yet
        </p>
        <p className="mt-1 text-label-sm text-muted-foreground">
          Generate a COI from the page header to store it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={String(row._id)}
          className="rounded-lg border border-foreground/6 bg-card px-4 py-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground truncate">
                {String(row.certificateHolderName ?? row.holderName ?? "Certificate of Insurance")}
              </p>
              <p className="mt-1 whitespace-pre-line text-label-sm text-muted-foreground">
                {String(row.certificateHolder ?? row.reasonMessage ?? "No certificate holder recorded")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{formatCertificateTimestamp(Number(row.createdAt))}</span>
                {typeof row.source === "string" && row.source ? (
                  <span>{String(row.source).replace("_", " ")}</span>
                ) : null}
                {row.activityType === "hold" ? (
                  <span>on hold</span>
                ) : (
                  <span>
                    {row.authorityType === "certified"
                      ? "certified"
                      : "non-binding"}
                  </span>
                )}
                {row.certificationStatus === "pending" && (
                  <span>pending approval</span>
                )}
              </div>
            </div>
            {row.activityType === "hold" ? (
              <Badge variant="outline" className="h-6 shrink-0 capitalize">
                Held
              </Badge>
            ) : (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={!row.url}
                onClick={() =>
                  typeof row.url === "string" && openWithUrl(row.url)
                }
              >
                <Eye className="w-3.5 h-3.5" />
                PDF
              </PillButton>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface PolicyDetailBodyProps {
  id: string;
  /** Called whenever the breadcrumb label changes. Host renders it. */
  onBreadcrumb?: (node: ReactNode) => void;
  /** Called whenever the header actions change. Host renders them. */
  onActions?: (node: ReactNode) => void;
  /** Called whenever the right-side panel changes. Host renders it next to the main pane. */
  onRightPanel?: (node: ReactNode) => void;
  /** Where to navigate after a policy is deleted. Default: /policies */
  afterDeleteHref?: string;
  /** Hide management actions for read-only connected-vendor policy access. */
  readOnly?: boolean;
}

export function PolicyDetailBody({
  id,
  onBreadcrumb,
  onActions,
  onRightPanel,
  afterDeleteHref = "/policies",
  readOnly = false,
}: PolicyDetailBodyProps) {
  const viewerOrg = useCachedViewerOrg();
  const searchParams = useSearchParams();
  const [showCertificateSheet, setShowCertificateSheet] = useState(false);
  const [activeTab, setActiveTab] = useState<PolicyDetailTab>(() =>
    parsePolicyDetailTab(searchParams.get("tab")),
  );
  const shouldLoadFullPolicy =
    activeTab === "extraction" || showCertificateSheet;
  const policySummary = useCachedPolicySummary(id as Id<"policies">);
  const fullPolicy = useCachedPolicyDetail(
    id as Id<"policies">,
    shouldLoadFullPolicy,
  );
  const policy = fullPolicy ?? policySummary;
  const auditEntries = useCachedQuery(
    "policyAuditLog.listByPolicy",
    api.policyAuditLog.listByPolicy,
    LOG_POLICY_ACTIVITY_IN_BROWSER
      ? { policyId: id as Id<"policies"> }
      : "skip",
  );
  const fileUrl = useCachedQuery(
    "policies.getFileUrl.detail",
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(
    api.actions.retryExtraction.retryExtraction,
  );

  const [reExtracting, setReExtracting] = useState(false);
  const [cancelingExtraction, setCancelingExtraction] = useState(false);
  const router = useRouter();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const loggedAuditIds = useRef<Set<string>>(new Set());
  const loggedPipelineEntries = useRef<Set<string>>(new Set());
  const loggedStatus = useRef<string | null>(null);

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const types = policy.policyTypes ?? [];
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${policy.mga ?? policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
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

  const p = (policy ?? {}) as unknown as Record<string, unknown>;
  const policyTypes: string[] = (p.policyTypes as string[] | undefined) ?? ["other"];
  const documentType: string =
    (p.documentType as string | undefined) ?? "policy";
  const carrierName = (p.carrier as string | undefined) ?? "";
  const administratorName = (p.mga as string | undefined) ?? "";
  const displayName = administratorName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!p.deletedAt;
  const canManagePolicyChanges =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canEditExtractedFields =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canRequestBrokerExtractionHelp =
    !!viewerOrg?.brokerOrg && !readOnly && !isDeleted;
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
  const canCancelExtraction =
    pipelineStatus === "running" || pipelineStatus === "paused";
  const isProcessingPolicy =
    !pipelineStatus ||
    pipelineStatus === "idle" ||
    pipelineStatus === "running" ||
    pipelineStatus === "paused";
  const rawPipelineLog = p.pipelineLog;
  const pipelineLog: PolicyPipelineLogEntry[] = useMemo(
    () =>
      Array.isArray(rawPipelineLog)
        ? (rawPipelineLog as PolicyPipelineLogEntry[])
        : [],
    [rawPipelineLog],
  );
  const policyDocument: Record<string, unknown> | undefined = p.document as
    | Record<string, unknown>
    | undefined;
  const limits: Record<string, unknown> | undefined = p.limits as
    | Record<string, unknown>
    | undefined;
  const deductibles: Record<string, unknown> | undefined = p.deductibles as
    | Record<string, unknown>
    | undefined;
  const extractionData: Record<string, unknown> = {
    ...(policyDocument ?? {}),
    coverages: p.coverages,
    premium: p.premium,
    totalCost: p.totalCost,
    minPremium: p.minPremium,
    depositPremium: p.depositPremium,
    taxesAndFees: p.taxesAndFees,
    premiumBreakdown: p.premiumBreakdown,
    limits,
    deductibles,
    declarations: p.declarations,
    formInventory: p.formInventory,
    supplementaryFacts: p.supplementaryFacts,
  };
  const reviewQuestions = extractionReviewQuestions(p);
  const hasExtractionReviews = reviewQuestions.length > 0;
  const visibleActiveTab =
    activeTab === "review" && !hasExtractionReviews ? "details" : activeTab;

  useEffect(() => {
    loggedAuditIds.current.clear();
    loggedPipelineEntries.current.clear();
    loggedStatus.current = null;
  }, [id]);

  useEffect(() => {
    if (!LOG_POLICY_ACTIVITY_IN_BROWSER || !policy) return;
    const statusKey = [
      policy._id,
      pipelineStatus ?? "unknown",
      (p.pipelineError as string | undefined) ?? "",
    ].join(":");
    if (loggedStatus.current === statusKey) return;
    loggedStatus.current = statusKey;
    logPolicyActivityToBrowser("status", {
      policyId: policy._id,
      policyNumber,
      status: pipelineStatus ?? "unknown",
      error: p.pipelineError,
    });
  }, [policy, pipelineStatus, p.pipelineError, policyNumber]);

  useEffect(() => {
    if (!LOG_POLICY_ACTIVITY_IN_BROWSER || !auditEntries) return;
    const orderedEntries = [...(auditEntries as PolicyAuditLogEntry[])].sort(
      (a, b) => a._creationTime - b._creationTime,
    );
    for (const entry of orderedEntries) {
      if (loggedAuditIds.current.has(entry._id)) continue;
      loggedAuditIds.current.add(entry._id);
      logPolicyActivityToBrowser("audit", {
        id: entry._id,
        policyId: entry.policyId,
        quoteId: entry.quoteId,
        policyNumber,
        action: entry.action,
        detail: entry.detail,
        metadata: entry.metadata,
        userId: entry.userId,
        orgId: entry.orgId,
        timestamp: dayjs(entry._creationTime).toISOString(),
      });
    }
  }, [auditEntries, policyNumber]);

  useEffect(() => {
    if (!LOG_POLICY_ACTIVITY_IN_BROWSER || pipelineLog.length === 0) return;
    for (const entry of pipelineLog) {
      const key = [
        entry.timestamp,
        entry.phase ?? "",
        entry.level ?? "",
        entry.message,
      ].join(":");
      if (loggedPipelineEntries.current.has(key)) continue;
      loggedPipelineEntries.current.add(key);
      logPolicyActivityToBrowser("pipeline_log", {
        policyId: id,
        policyNumber,
        timestamp: dayjs(entry.timestamp).toISOString(),
        phase: entry.phase,
        level: entry.level ?? "info",
        message: entry.message,
      });
    }
  }, [id, pipelineLog, policyNumber]);

  useEffect(() => {
    if (!onBreadcrumb) return;
    if (!policy) {
      onBreadcrumb(null);
      return;
    }
    onBreadcrumb(
      <>
        {displayName} {policyNumber}
        {documentType === "quote" && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
            Quote
          </span>
        )}
      </>,
    );
    return () => onBreadcrumb(null);
  }, [onBreadcrumb, policy, displayName, policyNumber, documentType]);

  const handleDelete = async () => {
    if (!policy) return;
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      toast.success("Policy deleted");
      router.push(afterDeleteHref);
    } catch {
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  const handleReextractFromSource = async () => {
    setReExtracting(true);
    try {
      await retryExtraction({ policyId: id as Id<"policies">, mode: "full" });
      toast.success("Re-extraction started");
      setShowRefreshDialog(false);
    } catch {
      toast.error("Re-extraction failed");
    } finally {
      setReExtracting(false);
    }
  };

  const handleCancelExtraction = useCallback(async () => {
    if (!policy) return;
    setCancelingExtraction(true);
    try {
      await cancelExtraction({ id: policy._id });
      toast.success("Extraction cancelled");
    } catch {
      toast.error("Failed to cancel extraction");
    } finally {
      setCancelingExtraction(false);
    }
  }, [cancelExtraction, policy]);

  useEffect(() => {
    if (!onActions) return;
    if (!policy) {
      onActions(null);
      return;
    }
    onActions(
      <>
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Delete"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4 shrink-0" strokeWidth={2} />
          </PillButton>
        )}
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Re-extract"
            disabled={isProcessingPolicy || reExtracting || cancelingExtraction}
            onClick={() => setShowRefreshDialog(true)}
          >
            {reExtracting ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <RotateCw className="size-4 shrink-0" />
            )}
          </PillButton>
        )}
        <ViewPdfButton url={fileUrl} disabled={isProcessingPolicy} />
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            disabled={isProcessingPolicy}
            onClick={() => setShowCertificateSheet(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Generate COI
          </PillButton>
        )}
      </>,
    );
    return () => onActions(null);
  }, [
    onActions,
    policy,
    readOnly,
    isDeleted,
    reExtracting,
    cancelingExtraction,
    canCancelExtraction,
    isProcessingPolicy,
    handleCancelExtraction,
    fileUrl,
    setShowCertificateSheet,
  ]);

  useEffect(() => {
    if (!onRightPanel) return;
    if (!policy || readOnly || !showCertificateSheet) {
      onRightPanel(null);
      return;
    }
    onRightPanel(
      <CertificateCreatePanel
        open={showCertificateSheet}
        onOpenChange={setShowCertificateSheet}
        policyId={policy._id}
        initialProgram={
          (policy as { partnerProgram?: ProgramMatchCandidate | null })
            .partnerProgram ?? null
        }
      />,
    );
    return () => onRightPanel(null);
  }, [onRightPanel, policy, readOnly, showCertificateSheet]);

  if (policy === undefined) {
    return <PolicyDetailSkeleton />;
  }

  if (policy === null) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">Policy not found</p>
        <Link
          href={afterDeleteHref}
          className="text-primary hover:underline text-body-sm"
        >
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <>
      <FadeIn when={true} staggerIndex={0} duration={0.6}>
        {isDeleted && (
          <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5">
            <p className="text-body-sm text-red-700 dark:text-red-400 flex-1">
              This policy has been deleted.
            </p>
            {!readOnly ? (
              <PillButton
                variant="secondary"
                size="compact"
                onClick={() => restorePolicy({ id: policy._id })}
              >
                Restore
              </PillButton>
            ) : null}
          </div>
        )}
      </FadeIn>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(v) => !v && setShowDeleteDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Policy</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{policyNumber}</strong>?
              The policy can be restored later.
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

      <Dialog
        open={showRefreshDialog}
        onOpenChange={(v) => !v && !reExtracting && setShowRefreshDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Re-extract policy data</DialogTitle>
            <DialogDescription>
              Rerun extraction from the original file for{" "}
              <strong>{policyNumber}</strong>. This will regenerate the
              structured policy data and searchable chunks.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowRefreshDialog(false)}
              disabled={reExtracting}
            >
              Cancel
            </PillButton>
            <PillButton
              onClick={handleReextractFromSource}
              disabled={reExtracting}
            >
              {reExtracting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Re-extract
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {Boolean(p.isDemo) && !demoBannerDismissed && (
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
            className="text-amber-500 hover:text-amber-700 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Tabs
        value={visibleActiveTab}
        onValueChange={(value) => setActiveTab(value as PolicyDetailTab)}
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Summary" },
              ...(hasExtractionReviews
                ? [{ id: "review" as const, label: "Review" }]
                : []),
              { id: "extraction" as const, label: "Breakdown" },
              { id: "certificates" as const, label: "Certificates" },
              { id: "changes" as const, label: "Changes" },
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.id === "review" ? (
                <span className="inline-flex items-center gap-1.5">
                  Review
                  <span className="rounded-full border border-foreground/10 px-1.5 text-[10px] leading-4 text-muted-foreground">
                    {reviewQuestions.length}
                  </span>
                </span>
              ) : (
                tab.label
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visibleActiveTab === "details" && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionBanner
            policyId={policy._id}
            status={p.pipelineStatus as PipelineStatus | undefined}
            error={p.pipelineError as string | undefined}
            log={pipelineLog}
            onCancel={canCancelExtraction ? handleCancelExtraction : undefined}
            cancelling={cancelingExtraction}
          />
          <PolicySummary
            policyNumber={policy.policyNumber}
            administrator={p.mga as string | undefined}
            carrier={
              (p.carrierLegalName as string | undefined) ||
              (p.security as string | undefined) ||
              policy.carrier
            }
            insuredName={policy.insuredName}
            effectiveDate={policy.effectiveDate}
            expirationDate={policy.expirationDate}
            premium={policy.premium}
            policyTypes={policyTypes}
            policyTermType={p.policyTermType as string | undefined}
            limits={limits}
            deductibles={deductibles}
            summary={policy.summary}
            isRenewal={policy.isRenewal}
            documentType={documentType}
            pdfUrl={fileUrl}
          />
        </FadeIn>
      )}

      {visibleActiveTab === "review" && hasExtractionReviews && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionReview
            policy={
              policy as unknown as Record<string, unknown> & {
                _id: Id<"policies">;
              }
            }
            readOnly={readOnly || isDeleted}
            canRequestBrokerHelp={canRequestBrokerExtractionHelp}
          />
        </FadeIn>
      )}

      {visibleActiveTab === "changes" && (
        <PolicyChangesTab policyId={id} canManage={canManagePolicyChanges} />
      )}

      {visibleActiveTab === "certificates" && (
        <CertificatesTab policyId={policy._id} />
      )}

      {visibleActiveTab === "extraction" && (
        <div className="space-y-4">
          {fullPolicy === undefined || fullPolicy === null ? (
            <PolicyDetailSkeleton />
          ) : (
            <>
              <PolicyBreakdownEditor
                key={fullPolicy._id}
                policy={
                  fullPolicy as unknown as Record<string, unknown> & {
                    _id: Id<"policies">;
                  }
                }
                readOnly={readOnly || isDeleted || !canEditExtractedFields}
              />
              <ExtractionCards
                policyDocument={extractionData}
                initialPage={initialPage}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
