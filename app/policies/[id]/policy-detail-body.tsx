"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type FormEvent, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import { BadgeCheck, CheckCircle2, Download, FileText, Loader2, Plus, RotateCw, Send, Trash2, Eye, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
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
import { ExtractionCards } from "./extraction-panel";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";

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

const LOG_POLICY_ACTIVITY_IN_BROWSER =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "development";

function logPolicyActivityToBrowser(
  event: "status" | "audit" | "pipeline_log",
  payload: Record<string, unknown>,
) {
  if (!LOG_POLICY_ACTIVITY_IN_BROWSER) return;
  console.info(`[policy-activity] ${event}`, payload);
}

function formatPolicyChangeStatus(status: string) {
  return status.replace("_", " ");
}

function policyChangeProgress(status: string) {
  switch (status) {
    case "draft":
      return 1;
    case "needs_info":
      return 2;
    case "ready":
      return 3;
    case "submitted":
      return 4;
    case "accepted":
      return 5;
    case "declined":
    case "cancelled":
      return 0;
    default:
      return 1;
  }
}

function isPolicyChangeTerminal(status: string) {
  return status === "accepted" || status === "declined" || status === "cancelled";
}

function PolicyChangeProgress({ status }: { status: string }) {
  const steps = ["Requested", "Review", "Ready", "Submitted", "Complete"];
  const completed = policyChangeProgress(status);
  const interrupted = status === "declined" || status === "cancelled";

  return (
    <div className="mt-4 max-w-3xl">
      <div className="flex items-start">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const active = !interrupted && stepNumber <= completed;
          const current = !interrupted && stepNumber === completed;
          const connectorActive = !interrupted && stepNumber < completed;
          return (
            <div
              key={step}
              className={`flex min-w-0 items-start ${index === steps.length - 1 ? "shrink-0" : "flex-1"}`}
            >
              <div className="flex w-[72px] shrink-0 flex-col items-center gap-1">
                <span
                  className={`mt-0.5 rounded-full transition-colors ${
                    current
                      ? "size-3 bg-foreground"
                      : active
                        ? "size-2.5 bg-foreground/70"
                        : "size-2.5 bg-foreground/15"
                  }`}
                />
                <span
                  className={`text-center text-[11px] leading-4 ${
                    current ? "font-medium text-foreground" : active ? "text-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {step}
                </span>
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={`mt-[7px] h-px min-w-4 flex-1 transition-colors ${
                    connectorActive ? "bg-foreground/50" : "bg-foreground/10"
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {interrupted && (
        <p className="mt-2 text-label-sm text-muted-foreground">
          This request is {formatPolicyChangeStatus(status)}.
        </p>
      )}
    </div>
  );
}

function PolicyChangesTab({
  policyId,
  canManage,
}: {
  policyId: string;
  canManage: boolean;
}) {
  const [selectedCaseId, setSelectedCaseId] = useState<Id<"policyChangeCases"> | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const cases = useQuery(api.policyChanges.listByPolicy, {
    policyId: policyId as Id<"policies">,
  });
  const activeCaseId = selectedCaseId ?? cases?.[0]?._id ?? null;
  const detail = useQuery(
    api.policyChanges.getCaseDetail,
    canManage && activeCaseId ? { caseId: activeCaseId } : "skip",
  );
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);

  if (cases === undefined) {
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
      <div className="rounded-lg border border-foreground/6 bg-card px-4 py-6 text-center">
        <p className="text-body-sm text-muted-foreground">
          No policy change requests recorded yet.
        </p>
      </div>
    );
  }

  const handleGeneratePacket = async () => {
    if (!activeCaseId) return;
    setPacketLoading(true);
    try {
      await generatePacket({ caseId: activeCaseId });
      toast.success("Carrier packet generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate packet");
    } finally {
      setPacketLoading(false);
    }
  };

  const handleStatus = async (status: "submitted" | "accepted" | "declined") => {
    if (!activeCaseId) return;
    setStatusLoading(status);
    try {
      await markStatus({ caseId: activeCaseId, status });
      toast.success(`Marked ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update status");
    } finally {
      setStatusLoading(null);
    }
  };

  const handleCancel = async (caseId: Id<"policyChangeCases">) => {
    setCancelLoading(caseId);
    try {
      await cancelRequest({ caseId });
      toast.success("Policy change request cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel request");
    } finally {
      setCancelLoading(null);
    }
  };

  if (!canManage) {
    return (
      <div className="space-y-3">
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

              <PolicyChangeProgress status={change.status} />

              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>Updated {new Date(change.updatedAt).toLocaleDateString()}</span>
                {missingInfoCount > 0 && <span>{missingInfoCount} question{missingInfoCount === 1 ? "" : "s"} open</span>}
                {issueCount > 0 && <span>{issueCount} issue{issueCount === 1 ? "" : "s"} to review</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const activeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = Array.isArray(activeCase?.items) ? activeCase.items as Record<string, unknown>[] : [];
  const missingInfo = Array.isArray(activeCase?.missingInfoQuestions)
    ? activeCase.missingInfoQuestions as Record<string, unknown>[]
    : [];
  const validationIssues = Array.isArray(activeCase?.validationIssues)
    ? activeCase.validationIssues as Record<string, unknown>[]
    : [];
  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts as Record<string, unknown>[] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
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
                isActive ? "bg-foreground/[0.035]" : "hover:bg-foreground/[0.02]"
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
                <span>{new Date(change.updatedAt).toLocaleDateString()}</span>
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
                    {packetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Packet
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("submitted")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "submitted" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Submitted
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("accepted")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "accepted" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Accepted
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("declined")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "declined" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    Declined
                  </PillButton>
                  {activeCase.status !== "cancelled" && activeCase.status !== "accepted" && activeCase.status !== "declined" && (
                    <PillButton
                      variant="secondary"
                      size="compact"
                      onClick={() => handleCancel(activeCase._id)}
                      disabled={cancelLoading !== null}
                    >
                      {cancelLoading === activeCase._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      Cancel
                    </PillButton>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">Affected Values</h3>
                <div className="mt-2 space-y-2">
                  {items.length > 0 ? items.map((item, i) => (
                    <div key={String(item.id ?? i)} className="rounded-md border border-foreground/6 p-3">
                      <p className="text-label-sm font-medium text-foreground">
                        {String(item.label ?? item.fieldPath ?? "Change item")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {String(item.action ?? "update")} · {String(item.kind ?? "general")}
                      </p>
                      <p className="mt-2 text-label-sm text-muted-foreground">
                        {String(item.beforeValue ?? "(not cited)")} → {String(item.requestedValue ?? item.afterValue ?? "(pending)")}
                      </p>
                      {Array.isArray(item.sourceSpanIds) && item.sourceSpanIds.length > 0 && (
                        <p className="mt-2 text-[11px] text-muted-foreground break-all">
                          evidence: {item.sourceSpanIds.join(", ")}
                        </p>
                      )}
                    </div>
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No structured change items yet.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">Validation</h3>
                <div className="mt-2 space-y-2">
                  {validationIssues.length > 0 ? validationIssues.map((issue, i) => (
                    <div key={`${String(issue.code ?? "issue")}-${i}`} className="rounded-md border border-foreground/6 p-3">
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
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No validation issues recorded.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">Packet Preview</h3>
                <div className="mt-2 space-y-2">
                  {artifacts.length > 0 ? artifacts.map((artifact, i) => (
                    <details key={`${String(artifact.kind ?? "artifact")}-${i}`} className="rounded-md border border-foreground/6 p-3">
                      <summary className="cursor-pointer text-label-sm font-medium text-foreground">
                        {String(artifact.title ?? artifact.kind ?? "Packet artifact")}
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
                        {String(artifact.content ?? "")}
                      </pre>
                    </details>
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No generated packet yet.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">Missing Info And Audit</h3>
                <div className="mt-2 space-y-3">
                  {missingInfo.length > 0 ? (
                    <div className="space-y-2">
                      {missingInfo.map((question, i) => (
                        <div key={String(question.id ?? i)} className="rounded-md border border-foreground/6 p-3">
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
                    <p className="text-label-sm text-muted-foreground">No open missing-info questions.</p>
                  )}
                  <div className="space-y-2">
                    {(detail.messages ?? []).map((message) => (
                      <div key={message._id} className="text-[11px] text-muted-foreground">
                        {new Date(message.createdAt).toLocaleString()} · {message.direction} · {message.channel ?? "case"} · {message.content.slice(0, 140)}
                      </div>
                    ))}
                    {(detail.validationReports ?? []).map((report) => (
                      <div key={report._id} className="text-[11px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleString()} · validation {report.status}
                      </div>
                    ))}
                    {(detail.evidenceLinks ?? []).map((link) => (
                      <div key={link._id} className="text-[11px] text-muted-foreground break-all">
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

function ViewPdfButton({ url }: { url?: string | null }) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="icon"
      size="compact"
      label={isPdfOpen ? "Hide PDF" : "View PDF"}
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="size-4 shrink-0" />
    </PillButton>
  );
}

function formatCertificateTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function CertificateCreatePanel({
  open,
  onOpenChange,
  policyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: Id<"policies">;
}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const [holderName, setHolderName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [generating, setGenerating] = useState(false);

  const reset = () => {
    setHolderName("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setState("");
    setPostalCode("");
  };

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
      });
      toast.success("Certificate generated");
      onOpenChange(false);
      reset();
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate certificate");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => !generating && onOpenChange(value)}
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
            disabled={generating || !holderName.trim()}
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
            Generate
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-body-sm text-muted-foreground">
          Create a certificate from this policy and list the certificate holder on the PDF.
        </p>

        <form id="certificate-create-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="certificate-holder-name">Certificate holder</Label>
            <Input
              id="certificate-holder-name"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder="Company or individual name"
              autoFocus
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-1">Address line 1</Label>
            <Input
              id="certificate-address-1"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              placeholder="Street address"
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-2">Address line 2</Label>
            <Input
              id="certificate-address-2"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              placeholder="Suite, floor, attention line"
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
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-state">State</Label>
              <Input
                id="certificate-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-postal-code">ZIP</Label>
              <Input
                id="certificate-postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                disabled={generating}
              />
            </div>
          </div>
        </form>
      </div>
    </SettingsDrawer>
  );
}

function CertificatesTab({ policyId }: { policyId: Id<"policies"> }) {
  const certificates = useQuery(api.certificates.listByPolicy, { policyId });

  if (certificates === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (certificates.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card px-4 py-8 text-center">
        <BadgeCheck className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
        <p className="text-body-sm font-medium text-foreground">No certificates yet</p>
        <p className="mt-1 text-label-sm text-muted-foreground">
          Generate a COI from the page header to store it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {certificates.map((certificate) => (
        <div
          key={certificate._id}
          className="rounded-lg border border-foreground/6 bg-card px-4 py-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground truncate">
                {certificate.certificateHolderName ?? "Certificate of Insurance"}
              </p>
              <p className="mt-1 whitespace-pre-line text-label-sm text-muted-foreground">
                {certificate.certificateHolder ?? "No certificate holder recorded"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{formatCertificateTimestamp(certificate.createdAt)}</span>
                {certificate.source && <span>{certificate.source.replace("_", " ")}</span>}
              </div>
            </div>
            <PillButton
              variant="secondary"
              size="compact"
              disabled={!certificate.url}
              onClick={() => certificate.url && window.open(certificate.url, "_blank", "noopener,noreferrer")}
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </PillButton>
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
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const auditEntries = useQuery(
    api.policyAuditLog.listByPolicy,
    LOG_POLICY_ACTIVITY_IN_BROWSER
      ? { policyId: id as Id<"policies"> }
      : "skip",
  );
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);

  const [reExtracting, setReExtracting] = useState(false);
  const [cancelingExtraction, setCancelingExtraction] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [showCertificateSheet, setShowCertificateSheet] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "details" | "extraction" | "certificates" | "changes"
  >("details");
  const loggedAuditIds = useRef<Set<string>>(new Set());
  const loggedPipelineEntries = useRef<Set<string>>(new Set());
  const loggedStatus = useRef<string | null>(null);

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const types =
        policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
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
  const policyTypes: string[] =
    (p.policyTypes as string[] | undefined) ??
    [(p.policyType as string | undefined) ?? "other"];
  const documentType: string = (p.documentType as string | undefined) ?? "policy";
  const carrierName = (p.carrier as string | undefined) ?? "";
  const administratorName = (p.mga as string | undefined) ?? "";
  const displayName = administratorName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!p.deletedAt;
  const canManagePolicyChanges =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
  const canCancelExtraction =
    pipelineStatus === "running" || pipelineStatus === "paused";
  const rawPipelineLog = p.pipelineLog;
  const pipelineLog: PolicyPipelineLogEntry[] = useMemo(
    () => Array.isArray(rawPipelineLog)
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
    const orderedEntries = [...(auditEntries as PolicyAuditLogEntry[])]
      .sort((a, b) => a._creationTime - b._creationTime);
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
        timestamp: new Date(entry._creationTime).toISOString(),
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
        timestamp: new Date(entry.timestamp).toISOString(),
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
            disabled={reExtracting || cancelingExtraction}
            onClick={() => setShowRefreshDialog(true)}
          >
            {reExtracting ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <RotateCw className="size-4 shrink-0" />
            )}
          </PillButton>
        )}
        <ViewPdfButton url={fileUrl} />
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
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
      />,
    );
    return () => onRightPanel(null);
  }, [onRightPanel, policy, readOnly, showCertificateSheet]);

  if (policy === undefined) {
    return (
      <>
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
              className="rounded-lg border border-foreground/6 bg-card px-4 py-3"
            >
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </>
    );
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
            className="text-amber-500 hover:text-amber-700 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "details" | "extraction" | "certificates" | "changes")
        }
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Summary" },
              { id: "extraction" as const, label: "Breakdown" },
              { id: "certificates" as const, label: "Certificates" },
              { id: "changes" as const, label: "Changes" },
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "details" && (
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
            totalCost={p.totalCost as string | undefined}
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

      {activeTab === "changes" && (
        <PolicyChangesTab policyId={id} canManage={canManagePolicyChanges} />
      )}

      {activeTab === "certificates" && (
        <CertificatesTab policyId={policy._id} />
      )}

      {activeTab === "extraction" && (
        <ExtractionCards
          policyDocument={extractionData}
          initialPage={initialPage}
        />
      )}
    </>
  );
}
