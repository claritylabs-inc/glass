"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { CheckCircle2, FileText, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  PolicyChangeProgress,
  formatPolicyChangeStatus,
} from "@/components/policy-change-progress";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

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

function declarationPolicyLabels(discrepancy: DeclarationDiscrepancy) {
  const labels = new Map<string, string>();
  for (const value of discrepancy.conflictingValues) {
    for (const policy of value.policyLabels ?? []) {
      labels.set(policy.policyId, policy.label);
    }
  }
  return Array.from(labels, ([policyId, label]) => ({ policyId, label }));
}

function humanizeSnake(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function displayPolicyChangeItemLabel(item: Record<string, unknown>) {
  const label = String(item.label ?? "").trim();
  if (label) return label;
  const field = humanizeSnake(item.fieldPath);
  return field || "Policy detail";
}

function displayPolicyChangeValue(value: unknown) {
  if (value === undefined || value === null || value === "")
    return "not listed";
  return String(value)
    .replace(/\bnull\b/gi, "not listed")
    .replace(/\bunknown\b/gi, "Unknown");
}

function displayValidationMessage(issue: Record<string, unknown>) {
  const message = String(issue.message ?? "").trim();
  if (message) {
    return message
      .replace(/source-span evidence/gi, "supporting policy evidence")
      .replace(/source span/gi, "policy evidence");
  }
  const code = humanizeSnake(issue.code);
  return code || "Review this item before sending.";
}

function policyChangeQuestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") {
      return {
        key: `${item}-${index}`,
        question: item,
      };
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return {
        key: String(record.id ?? record.code ?? index),
        question: String(record.question ?? "Missing information"),
        reason:
          typeof record.reason === "string" && record.reason.trim()
            ? record.reason
            : undefined,
      };
    }
    return {
      key: `question-${index}`,
      question: "Missing information",
    };
  });
}

type PolicyChangeCaseDetail = Record<string, unknown> & {
  _id: Id<"policyChangeCases">;
  status?: string;
  summary?: string;
  requestText?: string;
};

function nextCaseAfterReply<
  T extends {
    status?: string;
    pendingQuestions?: string[];
    missingInfoQuestions?: unknown;
    updatedAt?: number;
  },
>(changeCase: T): T {
  const pendingQuestions = Array.isArray(changeCase.pendingQuestions)
    ? changeCase.pendingQuestions.slice(1)
    : [];
  const missingInfoQuestions = Array.isArray(changeCase.missingInfoQuestions)
    ? changeCase.missingInfoQuestions.slice(1)
    : [];
  const stillNeedsInfo =
    pendingQuestions.length > 0 || missingInfoQuestions.length > 0;

  return {
    ...changeCase,
    pendingQuestions,
    missingInfoQuestions,
    status: stillNeedsInfo
      ? "needs_info"
      : changeCase.status === "needs_info"
        ? "ready_to_submit"
        : changeCase.status,
    updatedAt: dayjs().valueOf(),
  };
}

function DeclarationDiscrepancyListItems({
  discrepancies,
  activeDiscrepancyId,
  onSelect,
}: {
  discrepancies: DeclarationDiscrepancy[];
  activeDiscrepancyId: Id<"declarationDiscrepancies"> | null;
  onSelect: (id: Id<"declarationDiscrepancies">) => void;
}) {
  if (discrepancies.length === 0) return null;

  return (
    <>
      {discrepancies.map((discrepancy) => {
        const isActive = activeDiscrepancyId === discrepancy._id;
        return (
          <button
            key={discrepancy._id}
            type="button"
            onClick={() => onSelect(discrepancy._id)}
            className={`block w-full border-b border-foreground/[0.04] px-4 py-3 text-left transition-colors last:border-b-0 ${
              isActive ? "bg-foreground/[0.035]" : "hover:bg-foreground/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-foreground">
                  {formatDeclarationFieldGroup(discrepancy.fieldGroup)}
                </p>
                <p className="mt-1 line-clamp-2 text-label text-muted-foreground">
                  {discrepancy.question ??
                    discrepancy.plainLanguageSummary ??
                    "Confirm the value before using this policy."}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-500/20 px-2 py-0.5 text-label font-medium text-amber-700 dark:text-amber-300">
                {discrepancy.conflictingValues.length} values
              </span>
            </div>
          </button>
        );
      })}
    </>
  );
}

function DeclarationDiscrepancyDrawer({
  open,
  onOpenChange,
  discrepancy,
  selectedValue,
  confirming,
  onSelectValue,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  discrepancy: DeclarationDiscrepancy;
  selectedValue: string;
  confirming: boolean;
  onSelectValue: (value: string) => void;
  onConfirm: () => void;
}) {
  const policyLabels = declarationPolicyLabels(discrepancy);
  const values = discrepancy.conflictingValues
    .map((value) => ({
      value: displayDeclarationValue(value.displayValue ?? value.normalizedValue),
      policyLabels: value.policyLabels ?? [],
    }))
    .filter((value) => value.value !== "Needs confirmation");

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={formatDeclarationFieldGroup(discrepancy.fieldGroup)}
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          <PillButton
            type="button"
            disabled={!selectedValue || confirming}
            onClick={onConfirm}
          >
            {confirming ? "Saving..." : "Use selected value"}
          </PillButton>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <section>
          <p className="text-base font-medium text-foreground">
            {discrepancy.question ??
              formatDeclarationFieldGroup(discrepancy.fieldGroup)}
          </p>
          <p className="mt-2 text-base leading-6 text-muted-foreground">
            {discrepancy.plainLanguageSummary ??
              "Choose the value Glass should use for this near-duplicate policy."}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-label font-medium text-foreground">
            Select the correct value
          </h3>
          <RadioGroup value={selectedValue} onValueChange={onSelectValue}>
            {values.map((value) => {
              const checked = selectedValue === value.value;
              return (
                <label
                  key={value.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border bg-card p-3 text-left transition-colors ${
                    checked
                      ? "border-foreground/30 bg-foreground/[0.035]"
                      : "border-foreground/8 hover:border-foreground/16 hover:bg-foreground/[0.02]"
                  }`}
                >
                  <RadioGroupItem value={value.value} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-base font-medium text-foreground">
                      {value.value}
                    </p>
                    {value.policyLabels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {value.policyLabels.map((policy) => (
                          <Link
                            key={policy.policyId}
                            href={`/policies/${policy.policyId}`}
                            className="rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-label text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {policy.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        </section>

        {policyLabels.length > 0 && (
          <section>
            <h3 className="text-label font-medium text-foreground">
              Policies compared
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {policyLabels.map((policy) => (
                <Link
                  key={policy.policyId}
                  href={`/policies/${policy.policyId}`}
                  className="rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-label text-muted-foreground transition-colors hover:text-foreground"
                >
                  {policy.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {discrepancy.recommendedAction && (
          <section>
            <h3 className="text-label font-medium text-foreground">
              Suggested action
            </h3>
            <p className="mt-2 text-base leading-6 text-muted-foreground">
              {discrepancy.recommendedAction}
            </p>
          </section>
        )}
      </div>
    </SettingsDrawer>
  );
}

function PolicyChangeCaseDrawer({
  open,
  onOpenChange,
  activeCase,
  detailLoading,
  canManage,
  packetLoading,
  statusLoading,
  cancelLoading,
  activeReplyDraft,
  activeReplyLoading,
  items,
  validationIssues,
  artifacts,
  missingInfo,
  activeQuestions,
  onGeneratePacket,
  onStatus,
  onCancel,
  onReplyDraftChange,
  onReplySubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCase: PolicyChangeCaseDetail | null | undefined;
  detailLoading: boolean;
  canManage: boolean;
  packetLoading: boolean;
  statusLoading: string | null;
  cancelLoading: string | null;
  activeReplyDraft: string;
  activeReplyLoading: boolean;
  items: Record<string, unknown>[];
  validationIssues: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  missingInfo: Record<string, unknown>[];
  activeQuestions: Array<{ key: string; question: string; reason?: string }>;
  onGeneratePacket: () => void;
  onStatus: (status: "submitted" | "waiting_for_endorsement" | "completed" | "declined") => void;
  onCancel: (caseId: Id<"policyChangeCases">) => void;
  onReplyDraftChange: (caseId: Id<"policyChangeCases">, value: string) => void;
  onReplySubmit: (caseId: Id<"policyChangeCases">) => void;
}) {
  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Policy change request"
      actions={
        activeCase ? (
          <span className="rounded-full border border-foreground/8 px-2 py-0.5 text-label font-medium text-muted-foreground">
            {formatPolicyChangeStatus(String(activeCase.status ?? ""))}
          </span>
        ) : null
      }
    >
      {detailLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : activeCase ? (
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <section>
            <p className="text-base font-medium text-foreground">
              {activeCase.summary ?? "Policy change request"}
            </p>
            <p className="mt-2 text-base leading-6 text-muted-foreground">
              {activeCase.requestText}
            </p>
            {canManage ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <PillButton
                  variant="secondary"
                  size="compact"
                  onClick={onGeneratePacket}
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
                  onClick={() => onStatus("submitted")}
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
                  onClick={() => onStatus("waiting_for_endorsement")}
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
                  onClick={() => onStatus("completed")}
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
                  onClick={() => onStatus("declined")}
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
                      onClick={() =>
                        onCancel(activeCase._id)
                      }
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
            ) : null}
          </section>

          <section>
            <PolicyChangeProgress status={String(activeCase.status ?? "")} />
          </section>

          <section>
            <h3 className="text-label font-medium text-foreground">
              Requested changes
            </h3>
            <div className="mt-2 divide-y divide-foreground/6 border-y border-foreground/6">
              {items.length > 0 ? (
                items.map((item, i) => (
                  <div key={String(item.id ?? i)} className="py-3">
                    <p className="text-label font-medium text-foreground">
                      {displayPolicyChangeItemLabel(item)}
                    </p>
                    <p className="mt-2 text-label text-muted-foreground">
                      Current:{" "}
                      <span className="text-foreground">
                        {displayPolicyChangeValue(item.beforeValue)}
                      </span>{" "}
                      {"->"} Requested:{" "}
                      <span className="text-foreground">
                        {displayPolicyChangeValue(
                          item.requestedValue ?? item.afterValue,
                        )}
                      </span>
                    </p>
                    {item.action || item.kind ? (
                      <p className="mt-1 text-label text-muted-foreground">
                        {[humanizeSnake(item.action), humanizeSnake(item.kind)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="py-3 text-label text-muted-foreground">
                  No specific policy fields have been prepared yet.
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-label font-medium text-foreground">
              Items to check
            </h3>
            <div className="mt-2 divide-y divide-foreground/6 border-y border-foreground/6">
              {validationIssues.length > 0 ? (
                validationIssues.map((issue, i) => (
                  <div key={`${String(issue.code ?? "issue")}-${i}`} className="py-3">
                    <p className="text-label font-medium text-foreground">
                      {displayValidationMessage(issue)}
                    </p>
                    {issue.severity ? (
                      <p className="mt-1 text-label text-muted-foreground">
                        {humanizeSnake(issue.severity)}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="py-3 text-label text-muted-foreground">
                  No issues to review.
                </p>
              )}
            </div>
          </section>

          {canManage ? (
            <section>
              <h3 className="text-label font-medium text-foreground">
                Packet preview
              </h3>
              <div className="mt-2 space-y-2">
                {artifacts.length > 0 ? (
                  artifacts.map((artifact, i) => (
                    <details
                      key={`${String(artifact.kind ?? "artifact")}-${i}`}
                      className="border-y border-foreground/6 py-3"
                    >
                      <summary className="text-label font-medium text-foreground transition-colors hover:text-muted-foreground">
                        {String(
                          artifact.title ??
                            humanizeSnake(artifact.kind) ??
                            "Packet draft",
                        )}
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-label leading-5 text-muted-foreground">
                        {String(artifact.content ?? "")}
                      </pre>
                    </details>
                  ))
                ) : (
                  <p className="text-label text-muted-foreground">
                    No generated packet yet.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="text-label font-medium text-foreground">
              Information needed
            </h3>
            <div className="mt-2 space-y-3">
              {activeQuestions.length > 0 ? (
                <div className="rounded-lg border border-foreground/8 bg-foreground/[0.025] p-3">
                  <div className="space-y-3">
                    {activeQuestions.map((question) => (
                      <div key={question.key} className="space-y-2">
                        <p className="text-base text-foreground">
                          {question.question}
                        </p>
                        {question.reason ? (
                          <p className="text-label leading-5 text-muted-foreground">
                            {question.reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    <Textarea
                      value={activeReplyDraft}
                      onChange={(event) =>
                        onReplyDraftChange(
                          activeCase._id,
                          event.target.value,
                        )
                      }
                      placeholder="Enter the broker contact or email..."
                      disabled={activeReplyLoading}
                      className="min-h-20 bg-background"
                    />
                    <div className="flex justify-end">
                      <PillButton
                        type="button"
                        size="compact"
                        onClick={() =>
                          onReplySubmit(activeCase._id)
                        }
                        disabled={activeReplyLoading || !activeReplyDraft.trim()}
                      >
                        {activeReplyLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Submit response
                      </PillButton>
                    </div>
                  </div>
                </div>
              ) : missingInfo.length > 0 ? (
                <div className="divide-y divide-foreground/6 border-y border-foreground/6">
                  {missingInfo.map((question, i) => (
                    <div
                      key={String(question.id ?? question.code ?? i)}
                      className="py-3"
                    >
                      <p className="text-label text-foreground">
                        {String(question.question ?? "Missing information")}
                      </p>
                      {question.reason ? (
                        <p className="mt-1 text-label text-muted-foreground">
                          {String(question.reason)}
                        </p>
                      ) : null}
                      {question.answer ? (
                        <p className="mt-2 text-label text-muted-foreground">
                          Answer: {String(question.answer)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-label text-muted-foreground">
                  No open questions.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}

export function PolicyChangesTab({
  policyId,
  canManage,
  onRightPanel,
}: {
  policyId: string;
  canManage: boolean;
  onRightPanel?: (node: ReactNode) => void;
}) {
  const [selectedCaseId, setSelectedCaseId] =
    useState<Id<"policyChangeCases"> | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const [replyLoading, setReplyLoading] =
    useState<Id<"policyChangeCases"> | null>(null);
  const [selectedDiscrepancyId, setSelectedDiscrepancyId] =
    useState<Id<"declarationDiscrepancies"> | null>(null);
  const [selectedDiscrepancyValue, setSelectedDiscrepancyValue] =
    useState("");
  const [confirmingDiscrepancy, setConfirmingDiscrepancy] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
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
  const selectedDiscrepancy =
    declarationDiscrepancies?.find(
      (discrepancy) => discrepancy._id === selectedDiscrepancyId,
    ) ?? null;
  const activeCaseId = selectedDiscrepancy ? null : selectedCaseId;
  const detail = useCachedQuery(
    "policyChanges.getCaseDetail.policy",
    api.policyChanges.getCaseDetail,
    activeCaseId ? { caseId: activeCaseId } : "skip",
  );
  const updateCases = useUpdateCachedQuery<
    typeof cases,
    { policyId: Id<"policies"> }
  >("policyChanges.listByPolicy");
  const updateDetail = useUpdateCachedQuery<
    typeof detail,
    { caseId: Id<"policyChangeCases"> }
  >("policyChanges.getCaseDetail.policy");
  const updateDeclarationDiscrepancies = useUpdateCachedQuery<
    typeof declarationDiscrepancies,
    { policyId: Id<"policies"> }
  >("declarationFacts.listForPolicy");
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);
  const processReply = useMutation(api.policyChanges.processReply);
  const confirmDiscrepancyValue = useMutation(api.declarationFacts.confirmValue);

  const handleGeneratePacket = useCallback(async () => {
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
  }, [activeCaseId, generatePacket]);

  const handleStatus = useCallback(async (
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
      toast.success(
        status === "submitted" ? "Marked sent" : `Marked ${status}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update status",
      );
    } finally {
      setStatusLoading(null);
    }
  }, [activeCaseId, markStatus, policyId, updateCases, updateDetail]);

  const handleCancel = useCallback(async (caseId: Id<"policyChangeCases">) => {
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
  }, [cancelRequest, policyId, updateCases, updateDetail]);

  const handleReplyDraftChange = useCallback((
    caseId: Id<"policyChangeCases">,
    value: string,
  ) => {
    setReplyDrafts((current) => ({ ...current, [caseId]: value }));
  }, []);

  const handleReplySubmit = useCallback(async (caseId: Id<"policyChangeCases">) => {
    const replyText = replyDrafts[caseId]?.trim();
    if (!replyText) {
      toast.error("Enter a response before submitting");
      return;
    }

    setReplyLoading(caseId);
    try {
      await processReply({ caseId, replyText });
      await Promise.all([
        updateCases({ policyId: policyId as Id<"policies"> }, (current) =>
          current?.map((changeCase) =>
            changeCase._id === caseId
              ? nextCaseAfterReply(changeCase)
              : changeCase,
          ),
        ),
        updateDetail({ caseId }, (current) =>
          current?.case
            ? {
                ...current,
                case: nextCaseAfterReply(current.case),
              }
            : current,
        ),
      ]);
      setReplyDrafts((current) => {
        const next = { ...current };
        delete next[caseId];
        return next;
      });
      toast.success("Response added");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit response",
      );
    } finally {
      setReplyLoading(null);
    }
  }, [policyId, processReply, replyDrafts, updateCases, updateDetail]);

  const activeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = useMemo(
    () =>
      Array.isArray(activeCase?.items)
        ? (activeCase.items as Record<string, unknown>[])
        : [],
    [activeCase],
  );
  const missingInfo = useMemo(
    () =>
      Array.isArray(activeCase?.missingInfoQuestions)
        ? (activeCase.missingInfoQuestions as Record<string, unknown>[])
        : [],
    [activeCase],
  );
  const activeQuestions = useMemo(
    () => policyChangeQuestions(activeCase?.missingInfoQuestions),
    [activeCase],
  );
  const activeReplyDraft = activeCase
    ? (replyDrafts[activeCase._id] ?? "")
    : "";
  const activeReplyLoading = activeCase
    ? replyLoading === activeCase._id
    : false;
  const validationIssues = useMemo(
    () =>
      Array.isArray(activeCase?.validationIssues)
        ? (activeCase.validationIssues as Record<string, unknown>[])
        : [],
    [activeCase],
  );
  const artifacts = useMemo(
    () =>
      Array.isArray(packet?.artifacts)
        ? (packet.artifacts as Record<string, unknown>[])
        : [],
    [packet],
  );

  const closeDrawer = useCallback(() => {
    setSelectedCaseId(null);
    setSelectedDiscrepancyId(null);
    setSelectedDiscrepancyValue("");
  }, []);

  const handleConfirmDiscrepancy = useCallback(async () => {
    if (!selectedDiscrepancy || !selectedDiscrepancyValue) return;
    setConfirmingDiscrepancy(true);
    try {
      await confirmDiscrepancyValue({
        discrepancyId: selectedDiscrepancy._id,
        selectedValue: selectedDiscrepancyValue,
      });
      await updateDeclarationDiscrepancies(
        { policyId: policyId as Id<"policies"> },
        (current) =>
          current?.filter(
            (discrepancy) => discrepancy._id !== selectedDiscrepancy._id,
          ),
      );
      toast.success("Policy detail confirmed");
      closeDrawer();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not confirm value",
      );
    } finally {
      setConfirmingDiscrepancy(false);
    }
  }, [
    confirmDiscrepancyValue,
    closeDrawer,
    policyId,
    selectedDiscrepancy,
    selectedDiscrepancyValue,
    updateDeclarationDiscrepancies,
  ]);

  useEffect(() => {
    if (!onRightPanel) return;
    if (selectedDiscrepancy) {
      onRightPanel(
        <DeclarationDiscrepancyDrawer
          open
          discrepancy={selectedDiscrepancy}
          selectedValue={selectedDiscrepancyValue}
          confirming={confirmingDiscrepancy}
          onSelectValue={setSelectedDiscrepancyValue}
          onConfirm={handleConfirmDiscrepancy}
          onOpenChange={(open) => {
            if (!open) closeDrawer();
          }}
        />,
      );
      return () => onRightPanel(null);
    }
    if (selectedCaseId) {
      onRightPanel(
        <PolicyChangeCaseDrawer
          open
          activeCase={
            activeCase
              ? (activeCase as PolicyChangeCaseDetail)
              : activeCase
          }
          detailLoading={detail === undefined}
          canManage={canManage}
          packetLoading={packetLoading}
          statusLoading={statusLoading}
          cancelLoading={cancelLoading}
          activeReplyDraft={activeReplyDraft}
          activeReplyLoading={activeReplyLoading}
          items={items}
          validationIssues={validationIssues}
          artifacts={artifacts}
          missingInfo={missingInfo}
          activeQuestions={activeQuestions}
          onGeneratePacket={handleGeneratePacket}
          onStatus={handleStatus}
          onCancel={handleCancel}
          onReplyDraftChange={handleReplyDraftChange}
          onReplySubmit={handleReplySubmit}
          onOpenChange={(open) => {
            if (!open) closeDrawer();
          }}
        />,
      );
      return () => onRightPanel(null);
    }
    onRightPanel(null);
    return () => onRightPanel(null);
  }, [
    activeCase,
    activeQuestions,
    activeReplyDraft,
    activeReplyLoading,
    artifacts,
    canManage,
    cancelLoading,
    closeDrawer,
    confirmingDiscrepancy,
    detail,
    handleCancel,
    handleConfirmDiscrepancy,
    handleGeneratePacket,
    handleReplyDraftChange,
    handleReplySubmit,
    handleStatus,
    items,
    missingInfo,
    onRightPanel,
    packetLoading,
    selectedCaseId,
    selectedDiscrepancy,
    selectedDiscrepancyValue,
    statusLoading,
    validationIssues,
  ]);

  if (cases === undefined || declarationDiscrepancies === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <OperationalPanel as="div">
      <DeclarationDiscrepancyListItems
        discrepancies={declarationDiscrepancies}
        activeDiscrepancyId={selectedDiscrepancyId}
        onSelect={(id) => {
          setSelectedDiscrepancyId(id);
          setSelectedDiscrepancyValue("");
          setSelectedCaseId(null);
        }}
      />
      {cases.map((change) => {
        const missingInfoCount = Array.isArray(change.missingInfoQuestions)
          ? change.missingInfoQuestions.length
          : 0;
        const validationIssueCount = Array.isArray(change.validationIssues)
          ? change.validationIssues.length
          : 0;
        const isActive = selectedCaseId === change._id;
        return (
          <button
            key={change._id}
            type="button"
            onClick={() => {
              setSelectedCaseId(change._id);
              setSelectedDiscrepancyId(null);
              setSelectedDiscrepancyValue("");
            }}
            className={`block w-full border-b border-foreground/[0.04] px-4 py-3 text-left transition-colors last:border-b-0 ${
              isActive ? "bg-foreground/[0.035]" : "hover:bg-foreground/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-foreground">
                  {change.summary ?? "Policy change request"}
                </p>
                <p className="mt-1 line-clamp-2 text-label text-muted-foreground">
                  {change.requestText}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-foreground/8 px-2 py-0.5 text-label font-medium text-muted-foreground">
                {formatPolicyChangeStatus(change.status)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-label text-muted-foreground">
              {missingInfoCount > 0 && (
                <span>
                  {missingInfoCount} answer{missingInfoCount === 1 ? "" : "s"}{" "}
                  needed
                </span>
              )}
              {validationIssueCount > 0 && (
                <span>
                  {validationIssueCount} item
                  {validationIssueCount === 1 ? "" : "s"} to review
                </span>
              )}
            </div>
          </button>
        );
      })}
      {cases.length === 0 && declarationDiscrepancies.length === 0 && (
        <OperationalPanelBody className="px-4 py-6 text-center">
          <p className="text-base text-muted-foreground">
            No policy tasks recorded yet.
          </p>
        </OperationalPanelBody>
      )}
    </OperationalPanel>
  );
}
