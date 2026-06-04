"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { CheckCircle2, FileText, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { OperationalPanel, OperationalPanelBody } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyChangeProgress, formatPolicyChangeStatus, isPolicyChangeTerminal } from "@/components/policy-change-progress";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery, useUpdateCachedQuery } from "@/lib/sync/use-cached-query";

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
          <h3 className="text-base font-medium text-foreground">
            Policy details need confirmation
          </h3>
          <p className="mt-1 max-w-3xl text-label leading-5 text-muted-foreground">
            Different active policies show different values. Confirm the correct
            detail before using it on certificates, renewals, or policy changes.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/20 px-2 py-0.5 text-label font-medium text-amber-700 dark:text-amber-300">
          {discrepancies.length} to check
        </span>
      </div>

      <div className="mt-4 divide-y divide-foreground/6 border-t border-foreground/6">
        {discrepancies.map((discrepancy) => (
          <div key={discrepancy._id} className="py-3 first:pt-3 last:pb-0">
            <div className="grid gap-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1fr)_minmax(220px,1.4fr)_auto] md:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-label font-medium uppercase tracking-normal text-muted-foreground">
                  Detail
                </p>
                <p className="mt-1 text-label font-medium text-foreground">
                  {discrepancy.question ??
                    formatDeclarationFieldGroup(discrepancy.fieldGroup)}
                </p>
                {discrepancy.plainLanguageSummary && (
                  <p className="mt-1 text-label leading-5 text-muted-foreground">
                    {discrepancy.plainLanguageSummary}
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-label font-medium uppercase tracking-normal text-muted-foreground">
                  Best guess
                </p>
                <p className="mt-1 text-label font-medium text-foreground">
                  {displayDeclarationValue(discrepancy.likelyCurrentValue)}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-label font-medium uppercase tracking-normal text-muted-foreground">
                  Values found
                </p>
                <div className="mt-1 space-y-2">
                  {discrepancy.conflictingValues.map((value, index) => (
                    <div
                      key={`${value.normalizedValue ?? value.displayValue ?? "value"}-${index}`}
                      className="min-w-0"
                    >
                      <p className="break-words text-label font-medium text-foreground">
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
                              className="rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-label text-muted-foreground transition-colors hover:text-foreground"
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

              <span className="justify-self-start rounded-full border border-foreground/8 bg-background/60 px-2 py-0.5 text-label font-medium text-muted-foreground md:justify-self-end">
                Updated {dayjs(discrepancy.updatedAt).format("MMM D")}
              </span>
            </div>
            {discrepancy.recommendedAction && (
              <p className="mt-2 text-label leading-5 text-muted-foreground">
                {discrepancy.recommendedAction}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PolicyChangesTab({
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
        <DeclarationDiscrepancyList discrepancies={declarationDiscrepancies} />
        <OperationalPanel as="div">
          <OperationalPanelBody className="px-4 py-6 text-center">
            <p className="text-base text-muted-foreground">
              No policy change requests recorded yet.
            </p>
          </OperationalPanelBody>
        </OperationalPanel>
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
        <DeclarationDiscrepancyList discrepancies={declarationDiscrepancies} />
        {cases.map((change) => {
          const missingInfoCount = Array.isArray(change.missingInfoQuestions)
            ? change.missingInfoQuestions.length
            : 0;
          const issueCount = Array.isArray(change.validationIssues)
            ? change.validationIssues.length
            : 0;
          const terminal = isPolicyChangeTerminal(change.status);

          return (
            <OperationalPanel
              key={change._id}
              as="div"
              className="p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium text-foreground">
                      {change.summary ?? "Policy change request"}
                    </p>
                    <span className="rounded-full border border-foreground/8 px-2 py-0.5 text-label font-medium text-muted-foreground">
                      {formatPolicyChangeStatus(change.status)}
                    </span>
                  </div>
                  <p className="mt-2 max-w-3xl text-label leading-5 text-muted-foreground">
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

              <div className="mt-3 flex flex-wrap gap-3 text-label text-muted-foreground">
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
            </OperationalPanel>
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

      <OperationalPanel as="div">
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
                  <p className="text-base font-medium text-foreground truncate">
                    {change.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label text-muted-foreground line-clamp-2">
                    {change.requestText}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-foreground/8 px-2 py-0.5 text-label font-medium text-muted-foreground">
                  {formatPolicyChangeStatus(change.status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-label text-muted-foreground">
                <span>{humanizeSnake(change.sourceKind)}</span>
                <span>{dayjs(change.updatedAt).format("MMM D, YYYY")}</span>
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
      </OperationalPanel>

      <OperationalPanel as="div">
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
                  <p className="text-base font-medium text-foreground">
                    {activeCase.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label text-muted-foreground">
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
                          → Requested:{" "}
                          <span className="text-foreground">
                            {displayPolicyChangeValue(
                              item.requestedValue ?? item.afterValue,
                            )}
                          </span>
                        </p>
                        {item.action || item.kind ? (
                          <p className="mt-1 text-label text-muted-foreground">
                            {[
                              humanizeSnake(item.action),
                              humanizeSnake(item.kind),
                            ]
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
                      <div
                        key={`${String(issue.code ?? "issue")}-${i}`}
                        className="py-3"
                      >
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
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
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

              <section>
                <h3 className="text-label font-medium text-foreground">
                  Information needed
                </h3>
                <div className="mt-2 space-y-3">
                  {missingInfo.length > 0 ? (
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
          </div>
        ) : null}
      </OperationalPanel>
    </div>
  );
}


