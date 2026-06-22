"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cleanPolicyChangeCopy,
  formatPolicyChangeStatus,
  isPolicyChangeTerminal,
  policyChangeSourceLabel,
} from "@/components/policy-change-status";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import type { PolicyChangeAccess } from "../types";

type PolicyChangeCase = {
  _id: Id<"policyChangeCases">;
  requestText?: string;
  summary?: string;
  status?: string;
  sourceKind?: string;
  pendingQuestions?: unknown;
  missingInfoQuestions?: unknown;
  updatedAt?: number;
};

function compactText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asQuestionList(...values: unknown[]) {
  const questions: string[] = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const question =
        typeof item === "string"
          ? item
          : item && typeof item === "object" && !Array.isArray(item)
            ? compactText((item as Record<string, unknown>).question)
            : "";
      if (question && !questions.includes(question)) questions.push(question);
    }
  }
  return questions;
}

function policyLabel(policy: Record<string, unknown> | null | undefined) {
  if (!policy) return "";
  const number = compactText(policy.policyNumber);
  const carrier = compactText(policy.security) || compactText(policy.carrier);
  return [carrier, number].filter(Boolean).join(" ");
}

function changeTitle(changeCase: PolicyChangeCase | null | undefined) {
  return (
    cleanPolicyChangeCopy(
      compactText(changeCase?.summary) || compactText(changeCase?.requestText),
    ) || "Broker follow-up"
  );
}

function nextStep(changeCase: PolicyChangeCase, questions: string[]) {
  const status = changeCase.status ?? "intake";
  if (questions.length > 0 || status === "needs_info") {
    return questions[0] || "Reply in this chat with the missing details.";
  }
  if (status === "submitted" || status === "waiting_for_endorsement") {
    return "Glass will attach broker replies to this thread.";
  }
  if (status === "completed") return "The endorsement has been attached.";
  if (status === "cancelled") return "This follow-up was cancelled.";
  if (status === "declined") return "The broker declined this change.";
  return "Glass can draft the broker email from this conversation.";
}

export function PolicyChangeSummaryCard({
  caseId,
  onOpen,
  isOpen = false,
}: {
  caseId: Id<"policyChangeCases">;
  onOpen?: (caseId: Id<"policyChangeCases">) => void;
  isOpen?: boolean;
}) {
  const detail = useCachedQuery(
    "policyChanges.getCaseDetail",
    api.policyChanges.getCaseDetail,
    { caseId },
  );
  const changeCase = detail?.case as PolicyChangeCase | null | undefined;
  const questions = asQuestionList(
    changeCase?.pendingQuestions,
    changeCase?.missingInfoQuestions,
  );
  const title = changeTitle(changeCase);
  const status = formatPolicyChangeStatus(changeCase?.status, questions.length > 0);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(caseId)}
      className={`block w-full max-w-md rounded-md border bg-card px-3 py-2.5 text-left transition-colors active:scale-[0.998] ${
        isOpen
          ? "border-foreground/18"
          : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.025]"
      }`}
    >
      <span className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-label font-medium text-muted-foreground">
          Broker follow-up
        </span>
        <Badge
          variant="outline"
          className="h-5 shrink-0 border-foreground/10 px-1.5 text-label font-medium text-muted-foreground"
        >
          {status}
        </Badge>
      </span>
      <span className="mt-1 block truncate text-base font-medium leading-5 text-foreground">
        {title}
      </span>
      {changeCase ? (
        <span className="mt-1 block line-clamp-2 text-base leading-5 text-muted-foreground">
          {nextStep(changeCase, questions)}
        </span>
      ) : null}
    </button>
  );
}

export function PolicyChangeThreadSidebar({
  caseId,
  access,
  onClose,
}: {
  caseId: Id<"policyChangeCases">;
  access: PolicyChangeAccess;
  onClose: () => void;
}) {
  const detail = useCachedQuery(
    "policyChanges.getCaseDetail",
    api.policyChanges.getCaseDetail,
    { caseId },
  );
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);
  const updateDetail = useUpdateCachedQuery<
    typeof detail,
    { caseId: Id<"policyChangeCases"> }
  >("policyChanges.getCaseDetail");
  const [cancelling, setCancelling] = useState(false);

  const changeCase = detail?.case as PolicyChangeCase | null | undefined;
  const policy = detail?.policy as Record<string, unknown> | null | undefined;
  const certificateHold =
    detail?.linkedCertificateHold &&
    typeof detail.linkedCertificateHold === "object" &&
    !Array.isArray(detail.linkedCertificateHold)
      ? (detail.linkedCertificateHold as Record<string, unknown>)
      : null;
  const questions = asQuestionList(
    changeCase?.pendingQuestions,
    changeCase?.missingInfoQuestions,
  );
  const title = changeTitle(changeCase);
  const status = formatPolicyChangeStatus(changeCase?.status, questions.length > 0);
  const isClosed = isPolicyChangeTerminal(changeCase?.status);
  const metadata = [
    policyLabel(policy),
    policyChangeSourceLabel(changeCase?.sourceKind),
  ].filter(Boolean);

  async function cancel() {
    if (!changeCase) return;
    setCancelling(true);
    try {
      await cancelRequest({ caseId });
      await updateDetail({ caseId }, (current) =>
        current?.case
          ? {
              ...current,
              case: { ...current.case, status: "cancelled" },
            }
          : current,
      );
      toast.success("Broker follow-up cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">
            Broker follow-up
          </h2>
          {changeCase ? (
            <Badge
              variant="outline"
              className="h-5 shrink-0 border-foreground/10 px-1.5 text-label font-medium text-muted-foreground"
            >
              {status}
            </Badge>
          ) : null}
        </div>
        <PillButton
          size="compact"
          variant="icon"
          onClick={onClose}
          label="Close"
        >
          <X className="h-4 w-4" />
        </PillButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detail === undefined ? (
          <div className="space-y-3">
            <div className="h-5 w-48 rounded bg-foreground/[0.04]" />
            <div className="h-24 rounded-md bg-foreground/[0.035]" />
          </div>
        ) : changeCase ? (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="break-words text-base font-medium leading-5 text-foreground">
                {title}
              </h3>
              <p className="rounded-md border border-foreground/8 bg-foreground/[0.025] p-3 text-base leading-5 text-foreground">
                {nextStep(changeCase, questions)}
              </p>
              {metadata.length > 0 ? (
                <p className="text-base text-muted-foreground">
                  {metadata.join(" · ")}
                </p>
              ) : null}
            </section>

            {certificateHold ? (
              <section className="space-y-2 border-t border-foreground/6 pt-4">
                <h3 className="text-base font-medium text-foreground">
                  Held COI
                </h3>
                {compactText(certificateHold.holderName) ? (
                  <p className="text-base text-foreground">
                    {compactText(certificateHold.holderName)}
                  </p>
                ) : null}
                <p className="text-base leading-5 text-muted-foreground">
                  {cleanPolicyChangeCopy(
                    compactText(certificateHold.reasonMessage) ||
                      "This certificate needs broker confirmation before it can be issued.",
                  )}
                </p>
              </section>
            ) : null}

            {questions.length > 0 ? (
              <section className="space-y-2 border-t border-foreground/6 pt-4">
                <h3 className="text-base font-medium text-foreground">
                  Needed
                </h3>
                {questions.map((question) => (
                  <p key={question} className="text-base leading-5 text-foreground">
                    {question}
                  </p>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-base text-muted-foreground">Follow-up not found.</p>
        )}
      </div>

      {changeCase && !isClosed && access.canManage ? (
        <div className="flex shrink-0 justify-end border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={cancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Cancel
          </PillButton>
        </div>
      ) : null}
    </aside>
  );
}
