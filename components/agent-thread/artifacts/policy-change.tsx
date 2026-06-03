"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyChangeProgress, formatPolicyChangeStatus, isPolicyChangeTerminal } from "@/components/policy-change-progress";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import type { PolicyChangeAccess } from "../types";

type CachedPolicyChangeStatus = NonNullable<
  NonNullable<
    FunctionReturnType<typeof api.policyChanges.getCaseDetail>
  >["case"]
>["status"];

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
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
  const changeCase = detail?.case;
  const title = changeCase?.summary ?? "Policy change request";
  const status = formatPolicyChangeStatus(changeCase?.status);
  const missingInfo = asRecordArray(changeCase?.missingInfoQuestions).length;
  const validationIssues = asRecordArray(changeCase?.validationIssues).length;

  return (
    <div className={`w-fit min-w-md max-w-xl overflow-hidden rounded-md border bg-card transition-colors ${
      isOpen ? "border-foreground/18" : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.025]"
    }`}>
      <button
        type="button"
        onClick={() => onOpen?.(caseId)}
        className="block w-full min-w-0 px-3 py-2.5 text-left"
      >
        <span className="block truncate text-label font-medium leading-4 text-muted-foreground/45">
          Policy change request
        </span>
        <span className="block truncate text-base font-medium leading-5 text-foreground/85">
          {title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label leading-4 text-muted-foreground/40">
          <span className="capitalize">{status}</span>
          {missingInfo > 0 ? <span>{missingInfo} question{missingInfo === 1 ? "" : "s"}</span> : null}
          {validationIssues > 0 ? <span>{validationIssues} validation issue{validationIssues === 1 ? "" : "s"}</span> : null}
        </span>
      </button>
      {!isOpen ? (
        <div className="flex items-center justify-end border-t border-foreground/6 px-2 py-2">
          <PillButton
            type="button"
            size="compact"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(caseId);
            }}
            className="text-muted-foreground/60"
          >
            Review request
          </PillButton>
        </div>
      ) : null}
    </div>
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
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);
  const updateDetail = useUpdateCachedQuery<
    typeof detail,
    { caseId: Id<"policyChangeCases"> }
  >("policyChanges.getCaseDetail");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const changeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = asRecordArray(changeCase?.items);
  const missingInfo = asRecordArray(changeCase?.missingInfoQuestions);
  const validationIssues = asRecordArray(changeCase?.validationIssues);
  const artifacts = asRecordArray(packet?.artifacts);

  async function runAction(
    name: string,
    action: () => Promise<unknown>,
    success: string,
    nextStatus?: CachedPolicyChangeStatus,
  ) {
    setLoadingAction(name);
    try {
      await action();
      if (nextStatus) {
        await updateDetail({ caseId }, (current) =>
          current?.case
            ? {
                ...current,
                case: {
                  ...current.case,
                  status: nextStatus,
                },
              }
            : current,
        );
      }
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update policy change request");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">
            {changeCase?.summary ?? "Policy change request"}
          </h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-label font-medium capitalize text-muted-foreground/55">
            {formatPolicyChangeStatus(changeCase?.status)}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close policy change request">
          <X className="h-4 w-4" />
        </PillButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detail === undefined ? (
          <div className="space-y-3">
            <div className="h-5 w-48 rounded bg-foreground/[0.04]" />
            <div className="h-24 rounded-md bg-foreground/[0.035]" />
            <div className="h-24 rounded-md bg-foreground/[0.035]" />
          </div>
        ) : changeCase ? (
          <div className="space-y-5">
            <section>
              <h3 className="text-label font-medium text-muted-foreground/50">Request</h3>
              <p className="mt-2 whitespace-pre-wrap text-base leading-6 text-foreground/85">
                {changeCase.requestText}
              </p>
            </section>

            <PolicyChangeProgress status={changeCase.status} />

            {access.canManage ? (
              <>
                <section>
                  <h3 className="text-label font-medium text-muted-foreground/50">Affected values</h3>
                  <div className="mt-2 space-y-2">
                    {items.length > 0 ? items.map((item, index) => (
                      <div key={String(item.id ?? index)} className="rounded-md border border-foreground/6 p-3">
                        <p className="text-label font-medium text-foreground">
                          {String(item.label ?? item.fieldPath ?? "Change item")}
                        </p>
                        <p className="mt-1 text-label text-muted-foreground/45">
                          {String(item.action ?? "update")} · {String(item.kind ?? "general")}
                        </p>
                        <p className="mt-2 text-label text-muted-foreground/70">
                          {String(item.beforeValue ?? "(not cited)")} → {String(item.requestedValue ?? item.afterValue ?? "(pending)")}
                        </p>
                      </div>
                    )) : (
                      <p className="text-label text-muted-foreground/45">No structured change items yet.</p>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-label font-medium text-muted-foreground/50">Validation</h3>
                  <div className="mt-2 space-y-2">
                    {validationIssues.length > 0 ? validationIssues.map((issue, index) => (
                      <div key={`${String(issue.code ?? "issue")}-${index}`} className="rounded-md border border-foreground/6 p-3">
                        <p className="text-label font-medium text-foreground">
                          {String(issue.message ?? issue.code ?? "Validation issue")}
                        </p>
                        <p className="mt-1 text-label capitalize text-muted-foreground/45">
                          {String(issue.severity ?? "warning")}
                        </p>
                      </div>
                    )) : (
                      <p className="text-label text-muted-foreground/45">No validation issues recorded.</p>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            <section>
              <h3 className="text-label font-medium text-muted-foreground/50">Missing info</h3>
              <div className="mt-2 space-y-2">
                {missingInfo.length > 0 ? missingInfo.map((question, index) => (
                  <div key={String(question.id ?? index)} className="rounded-md border border-foreground/6 p-3">
                    <p className="text-label text-foreground">
                      {String(question.question ?? "Missing information")}
                    </p>
                  </div>
                )) : (
                  <p className="text-label text-muted-foreground/45">No open questions.</p>
                )}
              </div>
            </section>

            {access.canManage ? (
              <section>
                <h3 className="text-label font-medium text-muted-foreground/50">Packet preview</h3>
                <div className="mt-2 space-y-2">
                  {artifacts.length > 0 ? artifacts.map((artifact, index) => (
                    <details key={`${String(artifact.kind ?? "artifact")}-${index}`} className="rounded-md border border-foreground/6 p-3">
                      <summary className="text-label font-medium text-foreground transition-colors hover:text-muted-foreground">
                        {String(artifact.title ?? artifact.kind ?? "Packet artifact")}
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-label leading-5 text-muted-foreground">
                        {String(artifact.content ?? "")}
                      </pre>
                    </details>
                  )) : (
                    <p className="text-label text-muted-foreground/45">No generated packet yet.</p>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-base text-muted-foreground/45">Policy change request not found.</p>
        )}
      </div>

      {changeCase && access.canManage ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => runAction("packet", () => generatePacket({ caseId }), "Policy change packet generated")}
            disabled={loadingAction !== null}
          >
            {loadingAction === "packet" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Packet
          </PillButton>
          {!isPolicyChangeTerminal(changeCase.status) ? (
            <PillButton
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => runAction("cancel", () => cancelRequest({ caseId }), "Policy change request cancelled", "cancelled")}
              disabled={loadingAction !== null}
            >
              {loadingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Cancel
            </PillButton>
          ) : null}
          {(["submitted", "accepted", "declined"] as const).map((status) => (
            <PillButton
              key={status}
              type="button"
              variant="secondary"
              size="compact"
              onClick={() =>
                runAction(
                  status,
                  () => markStatus({ caseId, status }),
                  status === "submitted" ? "Marked sent" : `Marked ${status}`,
                  status,
                )
              }
              disabled={loadingAction !== null}
            >
              {loadingAction === status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span className="capitalize">{status === "submitted" ? "sent" : status}</span>
            </PillButton>
          ))}
        </div>
      ) : changeCase && !isPolicyChangeTerminal(changeCase.status) ? (
        <div className="flex shrink-0 justify-end border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => runAction("cancel", () => cancelRequest({ caseId }), "Policy change request cancelled")}
            disabled={loadingAction !== null}
          >
            {loadingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Cancel
          </PillButton>
        </div>
      ) : null}
    </aside>
  );
}
