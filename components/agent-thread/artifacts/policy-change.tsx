"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  formatPolicyChangeStatus,
  isPolicyChangeTerminal,
} from "@/components/policy-change-progress";
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
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function humanize(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function displayPolicyChangeValue(value: unknown) {
  if (value === undefined || value === null || value === "")
    return "Not listed";
  return String(value)
    .replace(/\bnull\b/gi, "not listed")
    .replace(/\bunknown\b/gi, "Unknown");
}

function compactText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function formatPolicyLabel(policy: Record<string, unknown> | undefined) {
  if (!policy) return "";
  const number = compactText(policy.policyNumber);
  const carrier = compactText(policy.security) || compactText(policy.carrier);
  const insured = compactText(policy.insuredName);
  const parenthetical = [carrier, insured].filter(Boolean).join(" - ");
  if (number && parenthetical) return `${number} (${parenthetical})`;
  return number || parenthetical;
}

const REQUEST_DETAIL_LABELS: Record<string, string> = {
  entityName: "Entity",
  address: "Address",
  contact: "Contact",
  effectiveDate: "Effective date",
};

const REQUEST_DETAIL_ORDER = [
  "entityName",
  "address",
  "contact",
  "effectiveDate",
];

function humanizeDetailKey(key: string) {
  return (
    REQUEST_DETAIL_LABELS[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\w/, (char) => char.toUpperCase())
  );
}

function displayRequestDetailValue(value: unknown) {
  if (typeof value === "string") return compactText(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    const scalarValues = value
      .map((item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
          ? String(item)
          : "",
      )
      .filter(Boolean);
    return scalarValues.length === value.length
      ? scalarValues.join(", ")
      : JSON.stringify(value);
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function requestDetailRows(value: unknown) {
  const details =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const keys = Object.keys(details).sort((a, b) => {
    const aIndex = REQUEST_DETAIL_ORDER.indexOf(a);
    const bIndex = REQUEST_DETAIL_ORDER.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (
        (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
        (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
      );
    }
    return a.localeCompare(b);
  });
  return keys
    .map((key) => ({
      label: humanizeDetailKey(key),
      value: displayRequestDetailValue(details[key]),
    }))
    .filter((row) => row.value);
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
    <div
      className={`w-full max-w-md overflow-hidden rounded-md border bg-card transition-colors ${
        isOpen
          ? "border-foreground/18"
          : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.025]"
      }`}
    >
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
          {missingInfo > 0 ? (
            <span>
              {missingInfo} question{missingInfo === 1 ? "" : "s"}
            </span>
          ) : null}
          {validationIssues > 0 ? (
            <span>
              {validationIssues} validation issue
              {validationIssues === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </button>
      {!isOpen ? (
        <div className="flex items-center justify-end border-t border-foreground/6 px-2 py-2">
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(caseId);
            }}
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
  const policy = detail?.policy as Record<string, unknown> | null | undefined;
  const packet = detail?.latestPacket;
  const items = asRecordArray(changeCase?.items);
  const missingInfo = asRecordArray(changeCase?.missingInfoQuestions);
  const validationIssues = asRecordArray(changeCase?.validationIssues);
  const artifacts = asRecordArray(packet?.artifacts);
  const caseNumber = String(caseId);
  const detailRows = requestDetailRows(changeCase?.requestDetails);
  const policyLabel = formatPolicyLabel(policy ?? undefined);

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
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not update policy change request",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">
            Policy Change {caseNumber}
          </h2>
          <Badge
            variant="outline"
            className="h-5 shrink-0 border-foreground/10 px-1.5 text-label font-medium capitalize text-muted-foreground/55"
          >
            {formatPolicyChangeStatus(changeCase?.status)}
          </Badge>
        </div>
        <PillButton
          size="compact"
          variant="icon"
          onClick={onClose}
          label="Close policy change request"
        >
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
            <OperationalLabelValueList title="Policy Change Details">
              {policyLabel ? (
                <OperationalLabelValueRow label="Policy" value={policyLabel} />
              ) : null}
              <OperationalLabelValueRow
                label="Request"
                value={changeCase.summary ?? changeCase.requestText}
              />
              {detailRows.length > 0
                ? detailRows.map((item) => (
                    <OperationalLabelValueRow
                      key={item.label}
                      label={item.label}
                      value={item.value}
                    />
                  ))
                : null}
            </OperationalLabelValueList>

            {access.canManage ? (
              <>
                <OperationalLabelValueList title="Affected values">
                  {items.length > 0 ? (
                    items.map((item, index) => (
                      <OperationalLabelValueRow
                        key={String(item.id ?? index)}
                        label={String(
                          item.label ?? item.fieldPath ?? "Change item",
                        )}
                        value={
                          <div className="space-y-1">
                            <p>
                              {displayPolicyChangeValue(item.beforeValue)}{" "}
                              <span className="text-muted-foreground/45">
                                to
                              </span>{" "}
                              {displayPolicyChangeValue(
                                item.requestedValue ?? item.afterValue,
                              )}
                            </p>
                            <p className="text-label text-muted-foreground">
                              {[
                                humanize(item.action) || "Update",
                                humanize(item.kind) || "General",
                              ].join(" · ")}
                            </p>
                          </div>
                        }
                      />
                    ))
                  ) : (
                    <OperationalLabelValueRow
                      label="Changes"
                      value="No structured change items yet."
                    />
                  )}
                </OperationalLabelValueList>

                <OperationalLabelValueList title="Validation">
                  {validationIssues.length > 0 ? (
                    validationIssues.map((issue, index) => (
                      <OperationalLabelValueRow
                        key={`${String(issue.code ?? "issue")}-${index}`}
                        label={humanize(issue.severity) || "Warning"}
                        value={String(
                          issue.message ?? issue.code ?? "Validation issue",
                        )}
                      />
                    ))
                  ) : (
                    <OperationalLabelValueRow
                      label="Status"
                      value="No validation issues recorded."
                    />
                  )}
                </OperationalLabelValueList>
              </>
            ) : null}

            <OperationalPanel as="section">
              <OperationalPanelHeader title="Missing info" />
              <OperationalPanelBody className="px-4 py-0">
                {missingInfo.length > 0 ? (
                  missingInfo.map((question, index) => (
                    <div
                      key={String(question.id ?? index)}
                      className="border-t border-foreground/6 py-3 first:border-t-0"
                    >
                      <p className="text-base leading-5 text-foreground">
                        {String(question.question ?? "Missing information")}
                      </p>
                      {question.reason ? (
                        <p className="mt-1 text-label leading-5 text-muted-foreground">
                          {String(question.reason)}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="py-3 text-base text-muted-foreground">
                    No open questions.
                  </p>
                )}
              </OperationalPanelBody>
            </OperationalPanel>

            {access.canManage ? (
              <OperationalPanel as="section">
                <OperationalPanelHeader title="Packet preview" />
                <OperationalPanelBody className="space-y-2">
                  {artifacts.length > 0 ? (
                    artifacts.map((artifact, index) => (
                      <details
                        key={`${String(artifact.kind ?? "artifact")}-${index}`}
                        className="rounded-md border border-foreground/6 p-3"
                      >
                        <summary className="text-label font-medium text-foreground transition-colors hover:text-muted-foreground">
                          {String(
                            artifact.title ??
                              artifact.kind ??
                              "Packet artifact",
                          )}
                        </summary>
                        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-label leading-5 text-muted-foreground">
                          {String(artifact.content ?? "")}
                        </pre>
                      </details>
                    ))
                  ) : (
                    <p className="text-base text-muted-foreground">
                      No generated packet yet.
                    </p>
                  )}
                </OperationalPanelBody>
              </OperationalPanel>
            ) : null}
          </div>
        ) : (
          <p className="text-base text-muted-foreground/45">
            Policy change request not found.
          </p>
        )}
      </div>

      {changeCase && access.canManage ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() =>
              runAction(
                "packet",
                () => generatePacket({ caseId }),
                "Policy change packet generated",
              )
            }
            disabled={loadingAction !== null}
          >
            {loadingAction === "packet" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            Packet
          </PillButton>
          {!isPolicyChangeTerminal(changeCase.status) ? (
            <PillButton
              type="button"
              variant="secondary"
              size="compact"
              onClick={() =>
                runAction(
                  "cancel",
                  () => cancelRequest({ caseId }),
                  "Policy change request cancelled",
                  "cancelled",
                )
              }
              disabled={loadingAction !== null}
            >
              {loadingAction === "cancel" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
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
              {loadingAction === status ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              <span className="capitalize">
                {status === "submitted" ? "sent" : status}
              </span>
            </PillButton>
          ))}
        </div>
      ) : changeCase && !isPolicyChangeTerminal(changeCase.status) ? (
        <div className="flex shrink-0 justify-end border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() =>
              runAction(
                "cancel",
                () => cancelRequest({ caseId }),
                "Policy change request cancelled",
              )
            }
            disabled={loadingAction !== null}
          >
            {loadingAction === "cancel" ? (
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
