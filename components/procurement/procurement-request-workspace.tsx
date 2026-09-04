"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Copy,
  Download,
  File,
  FileImage,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  ClientFileUploadPanel,
  type ClientFilePolicyOption,
} from "@/components/client-files/client-files-workspace";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  PacketSharingWorkspace,
  PacketWorkspace,
} from "@/components/procurement/packet-workspace";
import {
  EmailCategoryBadge,
  FILE_PURPOSE_OPTIONS,
  FILE_STATUS_OPTIONS,
  OUTREACH_STATUS_OPTIONS,
  OutreachStatusTag,
  ProcurementEmailDrawer,
  RequestStatusTag,
  REQUEST_STATUS_OPTIONS,
  procurementFilePurposeLabel,
  procurementFileStatusLabel,
  procurementOutreachStatusLabel,
  procurementRequestStatusLabel,
  writableProcurementRequestStatus,
  type ProcurementFilePurpose,
  type ProcurementFileStatus,
  type ProcurementOutreachStatus,
  type ProcurementRequestStatus,
  type StoredProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { inferProcurementUploadPurpose } from "@/lib/procurement-files";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NONE = "__none__";

type PolicyOption = {
  policyId: Id<"policies">;
  label: string;
  archived: boolean;
};

type ClientFileOption = {
  _id: Id<"clientFiles">;
  name: string;
  originalName: string;
  contentType: string;
  size: number;
  url: string | null;
  uploadedBySide: "operator" | "procurement_email" | "client";
};

type RequestSummary = {
  _id: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  narrative: string;
  targetEffectiveDate?: string;
  status: StoredProcurementRequestStatus;
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  forwardingAddress: string;
  brokerCount: number;
  quoteCount: number;
  outstandingFileCount: number;
  emailThreadCount: number;
  replacingPolicy: { policyId: Id<"policies">; label: string } | null;
  resultingPolicy: { policyId: Id<"policies">; label: string } | null;
  updatedAt: number;
};

type Outreach = {
  _id: Id<"procurementBrokerOutreaches">;
  brokerOrgId?: Id<"organizations">;
  brokerName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  status: ProcurementOutreachStatus;
  applicationUrl?: string;
  applicationQuestions: string[];
  notes?: string;
  quoteSummary?: string;
  quoteAmount?: number;
  quoteCurrency?: string;
  quoteUrl?: string;
  updatedAt: number;
};

type ProcurementFileItem = {
  _id: Id<"procurementFileItems">;
  outreachId?: Id<"procurementBrokerOutreaches">;
  clientFileId?: Id<"clientFiles">;
  sourceEmailMessageId?: Id<"procurementEmailMessages">;
  purpose: ProcurementFilePurpose;
  label: string;
  status: ProcurementFileStatus;
  brokerRelease?: "hidden" | "listed" | "attached";
  clientVisible?: boolean;
  notes?: string;
  updatedAt: number;
  clientFile: ClientFileOption | null;
};

type EmailThread = {
  _id: Id<"procurementEmailThreads">;
  subject: string;
  category: "broker" | "client" | "internal" | "mixed" | "other";
  participantEmails: string[];
  latestMessageAt: number;
  messageCount: number;
};

type RequestDetails = {
  request: RequestSummary;
  outreaches: Outreach[];
  files: ProcurementFileItem[];
  emailThreads: EmailThread[];
};

type BrokerOption = {
  _id: Id<"organizations">;
  name: string;
};

type ActiveProposalOption = {
  _id: Id<"procurementProposals">;
  outreachId: Id<"procurementBrokerOutreaches">;
  status: string;
  brokerName?: string;
};

function ProposalCreateDrawer({
  requestId,
  outreaches,
  fileItems,
  activeProposals,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  outreaches: Outreach[];
  fileItems: ProcurementFileItem[];
  activeProposals: ActiveProposalOption[];
  onClose: () => void;
}) {
  const eligible = outreaches.filter((outreach) => outreach.brokerOrgId);
  const [outreachId, setOutreachId] = useState(eligible[0]?._id ?? "");
  const [supersede, setSupersede] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedFileItemIds, setSelectedFileItemIds] = useState<
    Id<"procurementFileItems">[]
  >([]);
  const [saving, setSaving] = useState(false);
  const generateUploadUrl = useMutation(
    api.procurementProposals.generateUploadUrl,
  );
  const registerUpload = useMutation(api.procurementProposals.registerUpload);
  const discardUpload = useMutation(api.clientFiles.discardUpload);
  const fileProposal = useMutation(api.procurementProposals.file);
  const availableFileItems = fileItems.filter(
    (item) => item.clientFile && item.status !== "requested",
  );
  const hasSources = files.length > 0 || selectedFileItemIds.length > 0;
  // An outreach holds one active proposal at a time. Anything past draft has to
  // be superseded explicitly, which is what the agent path already does.
  const activeForOutreach = activeProposals.find(
    (proposal) => proposal.outreachId === outreachId,
  );
  const supersedable =
    activeForOutreach &&
    activeForOutreach.status !== "draft" &&
    activeForOutreach.status !== "selected"
      ? activeForOutreach
      : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const outreach = eligible.find((item) => item._id === outreachId);
    if (!outreach?.brokerOrgId || !hasSources) return;
    const pendingUploads: Array<{
      uploadIntentId: Id<"clientFileUploadIntents">;
      fileId?: Id<"_storage">;
    }> = [];
    setSaving(true);
    try {
      const sources: Array<
        | { kind: "file_item"; fileItemId: Id<"procurementFileItems"> }
        | {
            kind: "upload";
            fileId: Id<"_storage">;
            fileName: string;
            contentType?: string;
            uploadIntentId: Id<"clientFileUploadIntents">;
          }
      > = selectedFileItemIds.map((fileItemId) => ({
        kind: "file_item",
        fileItemId,
      }));
      for (const file of files) {
        const target = await generateUploadUrl({ requestId });
        const pending: (typeof pendingUploads)[number] = {
          uploadIntentId: target.uploadIntentId,
        };
        pendingUploads.push(pending);
        const response = await fetch(target.uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!response.ok) throw new Error("Upload failed");
        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };
        pending.fileId = storageId;
        await registerUpload({
          requestId,
          uploadIntentId: target.uploadIntentId,
          fileId: storageId,
        });
        sources.push({
          kind: "upload",
          fileId: storageId,
          fileName: file.name,
          contentType: file.type || "application/pdf",
          uploadIntentId: target.uploadIntentId,
        });
      }
      await fileProposal({
        requestId,
        outreachId: outreach._id,
        sources,
        supersedesProposalId:
          supersedable && supersede ? supersedable._id : undefined,
      });
      toast.success("Proposal filed and queued for extraction");
      onClose();
    } catch (error) {
      await Promise.allSettled(
        pendingUploads.map((upload) =>
          discardUpload({
            uploadIntentId: upload.uploadIntentId,
            fileId: upload.fileId,
          }),
        ),
      );
      toast.error(
        getUserFacingErrorMessage(error, "Could not file the proposal"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="File proposal"
      footer={
        <PillButton
          type="submit"
          form="proposal-create-form"
          disabled={saving || !outreachId || !hasSources}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}File
          proposal
        </PillButton>
      }
    >
      <form id="proposal-create-form" className="space-y-5" onSubmit={submit}>
        <div>
          <label
            className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
          >
            Broker outreach
          </label>
          <Select
            value={outreachId}
            items={eligible.map((outreach) => ({
              value: outreach._id,
              label: outreach.brokerName,
            }))}
            onValueChange={(value) =>
              setOutreachId((value ?? "") as Id<"procurementBrokerOutreaches">)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select broker" />
            </SelectTrigger>
            <SelectContent>
              {eligible.map((outreach) => (
                <SelectItem key={outreach._id} value={outreach._id}>
                  {outreach.brokerName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {eligible.length === 0 ? (
            <p className={`mt-2 text-warning ${typeStyle("body.default")}`}>
              Add a broker organization to Market before filing a proposal.
            </p>
          ) : null}
          {supersedable ? (
            <label className="mt-3 flex items-start gap-3 rounded-md border border-border px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={supersede}
                onChange={(event) => setSupersede(event.target.checked)}
              />
              <span className={typeStyle("body.default")}>
                File as a revision that withdraws the current{" "}
                {supersedable.status.replaceAll("_", " ")} proposal
                {supersedable.brokerName
                  ? ` from ${supersedable.brokerName}`
                  : ""}
              </span>
            </label>
          ) : activeForOutreach?.status === "selected" ? (
            <p className={`mt-2 text-warning ${typeStyle("body.default")}`}>
              This outreach holds the selected proposal. Select another reviewed
              proposal before filing a revision here.
            </p>
          ) : null}
        </div>
        <div>
          <label
            className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
          >
            Proposal documents
          </label>
          <Input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <p
            className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            All selected documents are filed atomically as one private proposal.
          </p>
        </div>
        {availableFileItems.length ? (
          <fieldset className="space-y-2">
            <legend
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Existing request files
            </legend>
            {availableFileItems.map((item) => (
              <label
                key={item._id}
                className="flex items-start gap-3 rounded-md border border-border px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={selectedFileItemIds.includes(item._id)}
                  onChange={(event) =>
                    setSelectedFileItemIds((current) =>
                      event.target.checked
                        ? [...current, item._id]
                        : current.filter((id) => id !== item._id),
                    )
                  }
                />
                <span>
                  <span className={`block ${typeStyle("body.medium")}`}>
                    {item.label}
                  </span>
                  <span
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {procurementFilePurposeLabel(item.purpose)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </form>
    </SettingsDrawer>
  );
}

type ProposalView = {
  _id: Id<"procurementProposals">;
  brokerName?: string;
  status: string;
  extractedOffer?: unknown;
  proposalMarkdown: string;
  sectionHeadings: Record<string, string>;
  documents: Array<{
    _id: Id<"procurementProposalDocuments">;
    fileName: string;
    url?: string | null;
  }>;
  reviews: Array<{
    _id: Id<"procurementProposalReviews">;
    modelConclusion:
      | "meets_requirements"
      | "has_gaps"
      | "insufficient_evidence";
    staffConclusion?:
      | "meets_requirements"
      | "has_gaps"
      | "insufficient_evidence";
    stale: boolean;
    findings: ProposalReviewFinding[];
  }>;
  extraction: {
    latest: {
      status: "pending" | "running" | "complete" | "failed";
      stuck: boolean;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
    } | null;
  };
};

type ProposalReviewFinding = {
  sectionKey: string;
  conclusion: "meets" | "has_gap" | "insufficient_evidence";
  summary: string;
  evidence: Array<{
    proposalDocumentId: string;
    pageStart: number | null;
  }>;
};

const FINDING_TONE = {
  meets: "success",
  has_gap: "danger",
  insufficient_evidence: "warning",
} as const;

const FINDING_LABEL = {
  meets: "Meets",
  has_gap: "Gap",
  insufficient_evidence: "Unverified",
} as const;

const REVIEW_CONCLUSION_LABELS = {
  meets_requirements: "Meets requirements",
  has_gaps: "Has gaps",
  insufficient_evidence: "Insufficient evidence",
} as const;

function ProposalReviewDrawer({
  proposal,
  onClose,
  onEvidence,
}: {
  proposal: ProposalView;
  onClose: () => void;
  onEvidence: (url: string, page?: number) => void;
}) {
  const confirmReview = useMutation(api.procurementProposals.confirmReview);
  const review = proposal.reviews[0];
  const [conclusion, setConclusion] = useState(
    review?.staffConclusion ??
      review?.modelConclusion ??
      "insufficient_evidence",
  );
  const [saving, setSaving] = useState(false);
  const documents = new Map(
    proposal.documents.map((document) => [String(document._id), document]),
  );
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${proposal.brokerName ?? "Broker"} proposal`}
    >
      <div className="space-y-5">
        <OperationalPanel>
          <OperationalPanelHeader title="Extracted proposal" />
          <OperationalPanelBody>
            {proposal.proposalMarkdown ? (
              <ProseMarkdown>{proposal.proposalMarkdown}</ProseMarkdown>
            ) : (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Nothing has been extracted from this proposal yet.
              </p>
            )}
          </OperationalPanelBody>
        </OperationalPanel>
        <OperationalPanel>
          <OperationalPanelHeader title="Source documents" />
          <OperationalPanelBody className="space-y-2">
            {proposal.documents.map((document) =>
              document.url ? (
                <PillButton
                  key={document._id}
                  href={document.url}
                  download={document.fileName}
                  variant="secondary"
                  className="w-full justify-start"
                >
                  <FileText className="size-3.5" />
                  {document.fileName}
                </PillButton>
              ) : (
                <p
                  key={document._id}
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {document.fileName}
                </p>
              ),
            )}
          </OperationalPanelBody>
        </OperationalPanel>
        {review ? (
          <OperationalPanel>
            <OperationalPanelHeader
              title="Packet review"
              action={
                review.stale ? (
                  <StatusTag tone="warning">Stale</StatusTag>
                ) : !review.staffConclusion ? (
                  <Select
                    value={conclusion}
                    items={REVIEW_CONCLUSION_LABELS}
                    onValueChange={(value) =>
                      setConclusion(value as typeof conclusion)
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REVIEW_CONCLUSION_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusTag
                    tone={
                      review.staffConclusion === "meets_requirements"
                        ? "success"
                        : "warning"
                    }
                  >
                    {REVIEW_CONCLUSION_LABELS[review.staffConclusion]}
                  </StatusTag>
                )
              }
            />
            <OperationalPanelBody className="space-y-3">
              {review.findings.map((finding) => {
                const evidence = finding.evidence[0];
                const document = evidence
                  ? documents.get(evidence.proposalDocumentId)
                  : undefined;
                const evidenceUrl = document?.url;
                return (
                  <div
                    key={finding.sectionKey}
                    className="border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className={typeStyle("body.medium")}>
                        {proposal.sectionHeadings[finding.sectionKey] ??
                          finding.sectionKey}
                      </p>
                      <StatusTag tone={FINDING_TONE[finding.conclusion]}>
                        {FINDING_LABEL[finding.conclusion]}
                      </StatusTag>
                    </div>
                    <p
                      className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      {finding.summary}
                    </p>
                    {evidenceUrl ? (
                      <PillButton
                        className="mt-2"
                        size="compact"
                        variant="secondary"
                        onClick={() =>
                          onEvidence(
                            evidenceUrl,
                            evidence?.pageStart ?? undefined,
                          )
                        }
                      >
                        Open evidence
                        {evidence?.pageStart
                          ? ` · p. ${evidence.pageStart}`
                          : ""}
                      </PillButton>
                    ) : null}
                  </div>
                );
              })}
              {review.stale ? (
                <p
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  The packet changed after this review ran. Re-run it before
                  confirming.
                </p>
              ) : !review.staffConclusion ? (
                <PillButton
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await confirmReview({ reviewId: review._id, conclusion });
                      toast.success("Proposal review confirmed");
                    } catch (error) {
                      toast.error(
                        getUserFacingErrorMessage(
                          error,
                          "Could not confirm the proposal review",
                        ),
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Confirm conclusion
                </PillButton>
              ) : null}
            </OperationalPanelBody>
          </OperationalPanel>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function RequestEditor({
  request,
  policies,
  onClose,
}: {
  request: RequestSummary;
  policies: PolicyOption[];
  onClose: () => void;
}) {
  const updateRequest = useMutation(api.procurementRequests.update);
  const [title, setTitle] = useState(request.title);
  const [narrative, setNarrative] = useState(request.narrative);
  const [targetEffectiveDate, setTargetEffectiveDate] = useState(
    request.targetEffectiveDate ?? "",
  );
  const [status, setStatus] = useState<ProcurementRequestStatus>(
    writableProcurementRequestStatus(request.status),
  );
  const [replacingPolicyId, setReplacingPolicyId] = useState(
    request.replacingPolicyId ?? NONE,
  );
  const [resultingPolicyId, setResultingPolicyId] = useState(
    request.resultingPolicyId ?? NONE,
  );
  const [saving, setSaving] = useState(false);

  const policyOptions = [
    { value: NONE, label: "No policy" },
    ...policies.map((policy) => ({
      value: policy.policyId,
      label: `${policy.label}${policy.archived ? " · Archived" : ""}`,
    })),
  ];

  async function save() {
    setSaving(true);
    try {
      await updateRequest({
        requestId: request._id,
        title,
        narrative,
        targetEffectiveDate: targetEffectiveDate || null,
        status,
        replacingPolicyId:
          replacingPolicyId === NONE
            ? null
            : (replacingPolicyId as Id<"policies">),
        resultingPolicyId:
          resultingPolicyId === NONE
            ? null
            : (resultingPolicyId as Id<"policies">),
      });
      toast.success("Procurement request updated");
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Failed to update procurement request",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="Edit request"
      footer={
        <>
          <PillButton variant="secondary" type="button" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Title
          </span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            What the client asked for
          </span>
          <Textarea
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            className="min-h-36"
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Target effective date
            </span>
            <Input
              type="date"
              value={targetEffectiveDate}
              onChange={(event) => setTargetEffectiveDate(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as ProcurementRequestStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {procurementRequestStatusLabel(status)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Policy being replaced
          </span>
          <SearchableSelect
            value={replacingPolicyId}
            options={policyOptions}
            onChange={setReplacingPolicyId}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Resulting policy
          </span>
          <SearchableSelect
            value={resultingPolicyId}
            options={policyOptions}
            onChange={setResultingPolicyId}
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

function OutreachEditor({
  requestId,
  outreach,
  brokers,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  outreach?: Outreach;
  brokers: BrokerOption[];
  onClose: () => void;
}) {
  const createOutreach = useMutation(api.procurementRequests.createOutreach);
  const updateOutreach = useMutation(api.procurementRequests.updateOutreach);
  const [brokerOrgId, setBrokerOrgId] = useState(outreach?.brokerOrgId ?? "");
  const [contactName, setContactName] = useState(outreach?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(
    outreach?.contactEmail ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    outreach?.contactPhone ?? "",
  );
  const [status, setStatus] = useState<ProcurementOutreachStatus>(
    outreach?.status ?? "request_sent",
  );
  const [applicationUrl, setApplicationUrl] = useState(
    outreach?.applicationUrl ?? "",
  );
  const [applicationQuestions, setApplicationQuestions] = useState(
    outreach?.applicationQuestions.join("\n") ?? "",
  );
  const [notes, setNotes] = useState(outreach?.notes ?? "");
  const [quoteSummary, setQuoteSummary] = useState(
    outreach?.quoteSummary ?? "",
  );
  const [quoteAmount, setQuoteAmount] = useState(
    outreach?.quoteAmount === undefined ? "" : String(outreach.quoteAmount),
  );
  const [quoteCurrency, setQuoteCurrency] = useState(
    outreach?.quoteCurrency ?? "USD",
  );
  const [quoteUrl, setQuoteUrl] = useState(outreach?.quoteUrl ?? "");
  const [saving, setSaving] = useState(false);

  function chooseBroker(value: string) {
    setBrokerOrgId(value);
    const broker = brokers.find((candidate) => candidate._id === value);
    if (!broker) return;
  }

  async function save() {
    if (!brokerOrgId) {
      toast.error("Select a broker organization");
      return;
    }
    const shared = {
      contactName: contactName || undefined,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
      status,
      applicationUrl: applicationUrl || undefined,
      applicationQuestions: applicationQuestions
        .split("\n")
        .map((question) => question.trim())
        .filter(Boolean),
      notes: notes || undefined,
      quoteSummary: quoteSummary || undefined,
      quoteAmount: quoteAmount ? Number(quoteAmount) : undefined,
      quoteCurrency: quoteCurrency || undefined,
      quoteUrl: quoteUrl || undefined,
    };
    setSaving(true);
    try {
      if (outreach) {
        await updateOutreach({
          outreachId: outreach._id,
          brokerOrgId: brokerOrgId as Id<"organizations">,
          ...shared,
          contactName: contactName || null,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
          applicationUrl: applicationUrl || null,
          notes: notes || null,
          quoteSummary: quoteSummary || null,
          quoteAmount: quoteAmount ? Number(quoteAmount) : null,
          quoteCurrency: quoteCurrency || null,
          quoteUrl: quoteUrl || null,
        });
        toast.success("Broker outreach updated");
      } else {
        await createOutreach({
          requestId,
          brokerOrgId: brokerOrgId as Id<"organizations">,
          ...shared,
        });
        toast.success("Broker added");
      }
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to save broker outreach"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={outreach ? "Edit broker outreach" : "Add broker"}
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save broker
          </PillButton>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
            Broker and contact
          </h3>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Spot broker organization
            </span>
            <SearchableSelect
              value={brokerOrgId}
              onChange={chooseBroker}
              options={brokers.map((broker) => ({
                value: broker._id,
                label: broker.name,
              }))}
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Broker name
            </span>
            <Input
              value={
                brokers.find((broker) => broker._id === brokerOrgId)?.name ?? ""
              }
              disabled
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder="Contact name"
            />
            <Input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="Contact email"
            />
          </div>
          <Input
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="Contact phone"
          />
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
            Workflow
          </h3>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as ProcurementOutreachStatus)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {procurementOutreachStatusLabel(status)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OUTREACH_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="url"
            value={applicationUrl}
            onChange={(event) => setApplicationUrl(event.target.value)}
            placeholder="Application file or form link"
          />
          <Textarea
            value={applicationQuestions}
            onChange={(event) => setApplicationQuestions(event.target.value)}
            className="min-h-28"
            placeholder="Application questions, one per line"
          />
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-24"
            placeholder="Broker notes and context"
          />
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
            Final quote
          </h3>
          <Textarea
            value={quoteSummary}
            onChange={(event) => setQuoteSummary(event.target.value)}
            className="min-h-24"
            placeholder="Quote summary, terms, deductibles, and notable exclusions"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={quoteAmount}
              onChange={(event) => setQuoteAmount(event.target.value)}
              placeholder="Premium"
            />
            <Input
              value={quoteCurrency}
              onChange={(event) => setQuoteCurrency(event.target.value)}
              maxLength={3}
              placeholder="USD"
            />
          </div>
          <Input
            type="url"
            value={quoteUrl}
            onChange={(event) => setQuoteUrl(event.target.value)}
            placeholder="Quote link"
          />
        </section>
      </div>
    </SettingsDrawer>
  );
}

function ProcurementFileEditor({
  requestId,
  fileItem,
  outreaches,
  clientFiles,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  fileItem?: ProcurementFileItem;
  outreaches: Outreach[];
  clientFiles: ClientFileOption[];
  onClose: () => void;
}) {
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
  const updateFileItem = useMutation(api.procurementRequests.updateFileItem);
  const [label, setLabel] = useState(fileItem?.label ?? "");
  const [purpose, setPurpose] = useState<ProcurementFilePurpose>(
    fileItem?.purpose ?? "requested_document",
  );
  const [status, setStatus] = useState<ProcurementFileStatus>(
    fileItem?.status ?? "requested",
  );
  const [outreachId, setOutreachId] = useState(fileItem?.outreachId ?? NONE);
  const [clientFileId, setClientFileId] = useState(
    fileItem?.clientFileId ?? NONE,
  );
  const [notes, setNotes] = useState(fileItem?.notes ?? "");
  const [brokerRelease, setBrokerRelease] = useState<
    "hidden" | "listed" | "attached"
  >(fileItem?.brokerRelease ?? "hidden");
  const [clientVisible, setClientVisible] = useState(
    fileItem?.clientVisible ?? false,
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!label.trim()) {
      toast.error("Enter a file label");
      return;
    }
    setSaving(true);
    try {
      if (fileItem) {
        await updateFileItem({
          fileItemId: fileItem._id,
          label,
          purpose,
          status,
          outreachId:
            outreachId === NONE
              ? null
              : (outreachId as Id<"procurementBrokerOutreaches">),
          clientFileId:
            clientFileId === NONE ? null : (clientFileId as Id<"clientFiles">),
          brokerRelease,
          clientVisible,
          notes: notes || null,
        });
        toast.success("Procurement file updated");
      } else {
        await createFileItem({
          requestId,
          label,
          purpose,
          status,
          outreachId:
            outreachId === NONE
              ? undefined
              : (outreachId as Id<"procurementBrokerOutreaches">),
          clientFileId:
            clientFileId === NONE
              ? undefined
              : (clientFileId as Id<"clientFiles">),
          brokerRelease,
          clientVisible,
          notes: notes || undefined,
        });
        toast.success("Procurement file added");
      }
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to save procurement file"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={fileItem ? "Edit procurement file" : "Add file request"}
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save file
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Label
          </span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Roof condition report"
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Purpose
            </span>
            <Select
              value={purpose}
              onValueChange={(value) =>
                setPurpose(value as ProcurementFilePurpose)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {procurementFilePurposeLabel(purpose)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILE_PURPOSE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as ProcurementFileStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{procurementFileStatusLabel(status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILE_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Broker outreach
          </span>
          <SearchableSelect
            value={outreachId}
            onChange={setOutreachId}
            options={[
              { value: NONE, label: "General request file" },
              ...outreaches.map((outreach) => ({
                value: outreach._id,
                label: outreach.brokerName,
              })),
            ]}
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Broker packet
            </span>
            <Select
              value={brokerRelease}
              onValueChange={(value) =>
                setBrokerRelease(value as "hidden" | "listed" | "attached")
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {brokerRelease === "hidden"
                    ? "Hidden"
                    : brokerRelease === "listed"
                      ? "List name only"
                      : "Attach file"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="listed">List name only</SelectItem>
                <SelectItem value="attached">Attach file</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-3 self-end rounded-md border border-border px-3 py-2">
            <input
              type="checkbox"
              className="size-4"
              checked={clientVisible}
              onChange={(event) => setClientVisible(event.target.checked)}
            />
            <span className={typeStyle("body.default")}>
              Show in client request
            </span>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Client file
          </span>
          <SearchableSelect
            value={clientFileId}
            onChange={(value) => {
              setClientFileId(value);
              if (value !== NONE && status === "requested")
                setStatus("available");
            }}
            options={[
              { value: NONE, label: "Not available yet" },
              ...clientFiles.map((file) => ({
                value: file._id,
                label: file.name,
              })),
            ]}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Notes
          </span>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-24"
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

function ImagePreview({
  file,
  onClose,
}: {
  file: ClientFileOption;
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={file.name}
      footer={
        file.url ? (
          <PillButton href={file.url} download={file.name} variant="secondary">
            <Download className="size-3.5" />
            Download
          </PillButton>
        ) : null
      }
    >
      {file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={file.name}
          className="h-auto max-h-[calc(100vh-11rem)] w-auto max-w-full object-contain"
        />
      ) : null}
    </SettingsDrawer>
  );
}

export function ProcurementRequestWorkspace({
  clientOrgId,
  requestId,
  basePath,
  view,
  readOnly,
  onActions,
  onRightPanel,
}: {
  clientOrgId: Id<"organizations">;
  requestId: Id<"procurementRequests">;
  basePath: string;
  view: "overview" | "packet" | "market" | "files" | "email";
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const router = useRouter();
  const result = useQuery(api.procurementRequests.get, { requestId });
  const policies = useQuery(api.procurementRequests.listPolicyOptions, {
    clientOrgId,
  });
  const policyRows = useQuery(api.policies.listForOrg, {
    orgId: clientOrgId,
    documentType: "policy",
  });
  const clientFilesResult = useQuery(api.clientFiles.list, {
    clientOrgId,
    limit: 250,
  });
  const requestRows = useQuery(api.procurementRequests.list, {
    clientOrgId,
    limit: 100,
  });
  const brokers = useCachedOperatorBrokers() as BrokerOption[] | undefined;
  const proposals = useQuery(api.procurementProposals.list, { requestId });
  const generateProposalReview = useAction(
    api.actions.proposalReview.generateReview,
  );
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
  const selectProposal = useMutation(api.procurementProposals.select);
  const archiveProposal = useMutation(api.procurementProposals.archive);
  const retryProposalExtraction = useMutation(
    api.procurementProposals.retryExtraction,
  );
  const cancelProposalExtraction = useMutation(
    api.procurementProposals.cancelExtraction,
  );
  const [reviewingProposalId, setReviewingProposalId] =
    useState<Id<"procurementProposals"> | null>(null);
  const [workingProposalAction, setWorkingProposalAction] = useState<
    string | null
  >(null);
  const { openWithUrl, closePdf } = usePdf();

  const details = result as RequestDetails | null | undefined;
  const policyOptions = useMemo(
    () => (policies ?? []) as PolicyOption[],
    [policies],
  );
  const clientFiles = useMemo(
    () => (clientFilesResult?.files ?? []) as ClientFileOption[],
    [clientFilesResult?.files],
  );
  const requestOptions = useMemo(
    () =>
      (requestRows ?? []) as Array<{
        _id: Id<"procurementRequests">;
        title: string;
      }>,
    [requestRows],
  );
  const closeRightPanel = useCallback(() => onRightPanel(null), [onRightPanel]);

  const openRequestEditor = useCallback(() => {
    if (!details) return;
    closePdf();
    onRightPanel(
      <RequestEditor
        request={details.request}
        policies={policyOptions}
        onClose={closeRightPanel}
      />,
    );
  }, [closePdf, closeRightPanel, details, onRightPanel, policyOptions]);

  const openOutreachEditor = useCallback(
    (outreach?: Outreach) => {
      closePdf();
      onRightPanel(
        <OutreachEditor
          requestId={requestId}
          outreach={outreach}
          brokers={brokers ?? []}
          onClose={closeRightPanel}
        />,
      );
    },
    [brokers, closePdf, closeRightPanel, onRightPanel, requestId],
  );

  const openFileEditor = useCallback(
    (fileItem?: ProcurementFileItem) => {
      if (!details) return;
      closePdf();
      onRightPanel(
        <ProcurementFileEditor
          requestId={requestId}
          fileItem={fileItem}
          outreaches={details?.outreaches ?? []}
          clientFiles={clientFiles}
          onClose={closeRightPanel}
        />,
      );
    },
    [clientFiles, closePdf, closeRightPanel, details, onRightPanel, requestId],
  );

  const openUpload = useCallback(() => {
    closePdf();
    onRightPanel(
      <ClientFileUploadPanel
        clientOrgId={clientOrgId}
        policies={(policyRows ?? []) as ClientFilePolicyOption[]}
        onClose={closeRightPanel}
        onUploaded={async (uploaded) => {
          await Promise.all(
            uploaded.map((file) =>
              createFileItem({
                requestId,
                clientFileId: file.clientFileId,
                purpose: inferProcurementUploadPurpose(file.originalName),
                label: file.originalName,
                status: "available",
              }),
            ),
          );
        }}
      />,
    );
  }, [
    clientOrgId,
    closePdf,
    closeRightPanel,
    createFileItem,
    onRightPanel,
    policyRows,
    requestId,
  ]);

  const openProposalCreate = useCallback(() => {
    if (!details) return;
    closePdf();
    onRightPanel(
      <ProposalCreateDrawer
        requestId={requestId}
        outreaches={details.outreaches}
        fileItems={details.files}
        activeProposals={(proposals ?? []).filter(
          (proposal) =>
            proposal.status !== "archived" && proposal.status !== "withdrawn",
        )}
        onClose={closeRightPanel}
      />,
    );
  }, [closePdf, closeRightPanel, details, onRightPanel, proposals, requestId]);

  const openProposalReview = useCallback(
    (proposal: ProposalView) => {
      closePdf();
      onRightPanel(
        <ProposalReviewDrawer
          proposal={proposal}
          onClose={closeRightPanel}
          onEvidence={(url, page) => {
            onRightPanel(null);
            openWithUrl(url, page);
          }}
        />,
      );
    },
    [closePdf, closeRightPanel, onRightPanel, openWithUrl],
  );

  const openEmail = useCallback(
    (emailThreadId: Id<"procurementEmailThreads">) => {
      closePdf();
      onRightPanel(
        <ProcurementEmailDrawer
          emailThreadId={emailThreadId}
          requests={requestOptions}
          readOnly={readOnly}
          onClose={closeRightPanel}
        />,
      );
    },
    [closePdf, closeRightPanel, onRightPanel, readOnly, requestOptions],
  );

  useEffect(() => {
    if (readOnly) {
      onActions?.(null);
      return () => onActions?.(null);
    }

    const actions =
      view === "overview" ? (
        <PillButton
          type="button"
          variant="secondary"
          onClick={openRequestEditor}
        >
          <Pencil className="size-3.5" />
          Edit request
        </PillButton>
      ) : view === "market" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => openOutreachEditor()}
          >
            <Plus className="size-3.5" />
            Add broker
          </PillButton>
          <PillButton type="button" onClick={openProposalCreate}>
            <Plus className="size-3.5" />
            File proposal
          </PillButton>
        </>
      ) : view === "files" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => openFileEditor()}
          >
            <Plus className="size-3.5" />
            Add file request
          </PillButton>
          <PillButton type="button" onClick={openUpload}>
            <Upload className="size-3.5" />
            Upload files
          </PillButton>
        </>
      ) : null;

    onActions?.(actions);
    return () => onActions?.(null);
  }, [
    onActions,
    openFileEditor,
    openOutreachEditor,
    openRequestEditor,
    openUpload,
    openProposalCreate,
    readOnly,
    view,
  ]);

  async function copyAddress() {
    if (!details) return;
    await navigator.clipboard.writeText(details.request.forwardingAddress);
    toast.success("Forwarding address copied");
  }

  function previewFile(file: ClientFileOption) {
    if (!file.url) return;
    const pdf =
      file.contentType === "application/pdf" || /\.pdf$/i.test(file.name);
    const image =
      file.contentType.startsWith("image/") ||
      /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);
    if (pdf) {
      onRightPanel(null);
      openWithUrl(file.url);
    } else if (image) {
      closePdf();
      onRightPanel(<ImagePreview file={file} onClose={closeRightPanel} />);
    }
  }

  async function reviewProposal(proposalId: Id<"procurementProposals">) {
    setReviewingProposalId(proposalId);
    try {
      const result = await generateProposalReview({ proposalId });
      toast.success(
        `Proposal review generated with ${result.findingCount} finding${result.findingCount === 1 ? "" : "s"}`,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not generate the proposal review",
        ),
      );
    } finally {
      setReviewingProposalId(null);
    }
  }

  async function runProposalMutation(
    key: string,
    action: () => Promise<unknown>,
    success: string,
    failure: string,
  ) {
    setWorkingProposalAction(key);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, failure));
    } finally {
      setWorkingProposalAction(null);
    }
  }

  if (
    result === undefined ||
    policies === undefined ||
    policyRows === undefined ||
    clientFilesResult === undefined ||
    requestRows === undefined ||
    brokers === undefined ||
    proposals === undefined
  ) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  if (!details || details.request.clientOrgId !== clientOrgId) {
    return (
      <OperationalPanel>
        <OperationalPanelHeader title="Procurement request not found" />
        <OperationalPanelBody>
          <PillButton href={basePath} variant="secondary">
            Back to procurement
          </PillButton>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const outreachById = new Map(
    details.outreaches.map((outreach) => [outreach._id, outreach]),
  );
  const activeProposals = proposals.filter(
    (proposal) =>
      proposal.status !== "archived" && proposal.status !== "withdrawn",
  );
  const proposalOutreachIds = new Set(
    activeProposals.map((proposal) => String(proposal.outreachId)),
  );
  const outreachesWithoutProposal = details.outreaches.filter(
    (outreach) => !proposalOutreachIds.has(String(outreach._id)),
  );
  const blockers = [
    ...(details.outreaches.length === 0
      ? ["No broker outreach has been added"]
      : []),
    ...(details.request.outstandingFileCount
      ? [
          `${details.request.outstandingFileCount} requested file${details.request.outstandingFileCount === 1 ? " is" : "s are"} outstanding`,
        ]
      : []),
    ...(activeProposals.filter(
      (proposal) =>
        proposal.extraction.latest?.stuck ||
        proposal.extraction.latest?.status === "failed",
    ).length
      ? ["Proposal extraction needs attention"]
      : []),
  ];
  const nextActions = blockers.length
    ? blockers
    : activeProposals.some((proposal) => proposal.status === "review_ready")
      ? ["Review extracted proposals against the broker packet"]
      : details.outreaches.some(
            (outreach) => outreach.status === "quote_received",
          ) && activeProposals.length === 0
        ? ["File received quote documents as proposals"]
        : [
            "Continue broker follow-up and import replies at the forwarding address",
          ];
  const requestPath = `${basePath}/${requestId}`;

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <Tabs
          value={view}
          onValueChange={(nextView) =>
            router.push(
              nextView === "overview"
                ? requestPath
                : `${requestPath}?view=${nextView}`,
            )
          }
        >
          <TabsList variant="pill" aria-label="Procurement request view">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="packet">Packet</TabsTrigger>
            <TabsTrigger value="market">
              Market
              <span className="text-muted-foreground/60">
                {details.outreaches.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="files">
              Files
              <span className="text-muted-foreground/60">
                {details.files.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="email">
              Imported email
              <span className="text-muted-foreground/60">
                {details.emailThreads.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "overview" ? (
        <div className="space-y-4">
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Current stage"
              value={<RequestStatusTag status={details.request.status} />}
            />
            <OperationalLabelValueRow
              label="Market"
              value={`${details.request.brokerCount} brokers · ${activeProposals.length} proposals`}
            />
            <OperationalLabelValueRow
              label="Target effective date"
              value={formatDisplayDate(
                details.request.targetEffectiveDate,
                "Not set",
              )}
            />
            <OperationalLabelValueRow label="Next" value={nextActions[0]} />
          </OperationalLabelValueList>
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="What the client asked for"
              layout="stacked"
              value={
                <span className="whitespace-pre-wrap">
                  {details.request.narrative}
                </span>
              }
            />
          </OperationalLabelValueList>
        </div>
      ) : null}

      {view === "packet" ? (
        <PacketWorkspace
          key={requestId}
          requestId={requestId}
          readOnly={readOnly}
        />
      ) : null}

      {view === "market" ? (
        <div className="space-y-4">
          <PacketSharingWorkspace requestId={requestId} readOnly={readOnly} />
          {activeProposals.length ? (
            <OperationalPanel as="section">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broker</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeProposals.map((proposal) => {
                    const offer = (proposal.extractedOffer ?? {}) as {
                      premium?: string;
                      premiumAmount?: number;
                      proposedEffectiveDate?: string;
                      proposedExpirationDate?: string;
                      coverages?: Array<{ name?: string; limit?: string }>;
                    };
                    const review = proposal.reviews[0];
                    const conclusion = review?.stale
                      ? undefined
                      : (review?.staffConclusion ?? review?.modelConclusion);
                    const latestExtraction = proposal.extraction.latest;
                    return (
                      <TableRow key={proposal._id}>
                        <TableCell>
                          <button
                            type="button"
                            className={`text-left text-foreground underline-offset-4 hover:underline ${typeStyle("body.medium")}`}
                            onClick={() =>
                              openProposalReview(proposal as ProposalView)
                            }
                          >
                            {proposal.brokerName ?? "Broker"}
                          </button>
                          <p
                            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {offer.coverages
                              ?.slice(0, 2)
                              .map((coverage) =>
                                [coverage.name, coverage.limit]
                                  .filter(Boolean)
                                  .join(" "),
                              )
                              .filter(Boolean)
                              .join(" · ") || "No coverage summary"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusTag
                            tone={
                              proposal.status === "selected"
                                ? "success"
                                : proposal.status === "reviewed"
                                  ? "info"
                                  : "neutral"
                            }
                          >
                            {proposal.status.replaceAll("_", " ")}
                          </StatusTag>
                          {latestExtraction?.stuck ? (
                            <p
                              className={`mt-1 text-warning ${typeStyle("caption.default")}`}
                            >
                              Extraction lease expired
                            </p>
                          ) : latestExtraction?.status === "failed" ? (
                            <p
                              className={`mt-1 max-w-48 truncate text-destructive ${typeStyle("caption.default")}`}
                              title={latestExtraction.lastError ?? undefined}
                            >
                              {latestExtraction.lastError ||
                                "Extraction failed"}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {offer.premium ?? offer.premiumAmount ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {[
                            offer.proposedEffectiveDate,
                            offer.proposedExpirationDate,
                          ]
                            .filter(Boolean)
                            .join(" – ") || "—"}
                        </TableCell>
                        <TableCell>
                          {review?.stale ? (
                            <StatusTag tone="warning">Stale</StatusTag>
                          ) : conclusion ? (
                            <StatusTag
                              tone={
                                conclusion === "meets_requirements"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {REVIEW_CONCLUSION_LABELS[conclusion]}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">
                              Not reviewed
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {proposal.documents.length}
                        </TableCell>
                        <TableCell>
                          {!readOnly ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              {(!review || review.stale) &&
                              proposal.extractedOffer ? (
                                <PillButton
                                  size="compact"
                                  variant="secondary"
                                  disabled={
                                    reviewingProposalId === proposal._id
                                  }
                                  onClick={() =>
                                    void reviewProposal(proposal._id)
                                  }
                                >
                                  {reviewingProposalId === proposal._id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : null}
                                  {review?.stale
                                    ? "Re-run review"
                                    : "Generate review"}
                                </PillButton>
                              ) : review &&
                                !review.stale &&
                                !review.staffConclusion ? (
                                <PillButton
                                  size="compact"
                                  variant="secondary"
                                  onClick={() =>
                                    openProposalReview(proposal as ProposalView)
                                  }
                                >
                                  Review
                                </PillButton>
                              ) : proposal.status === "reviewed" &&
                                conclusion === "meets_requirements" ? (
                                <PillButton
                                  size="compact"
                                  onClick={() =>
                                    void selectProposal({
                                      proposalId: proposal._id,
                                    })
                                  }
                                >
                                  Select
                                </PillButton>
                              ) : null}
                              {latestExtraction?.stuck ||
                              latestExtraction?.status === "failed" ? (
                                <PillButton
                                  size="compact"
                                  variant="secondary"
                                  disabled={workingProposalAction !== null}
                                  onClick={() =>
                                    void runProposalMutation(
                                      `retry:${proposal._id}`,
                                      () =>
                                        retryProposalExtraction({
                                          proposalId: proposal._id,
                                        }),
                                      "Proposal extraction queued",
                                      "Could not retry proposal extraction",
                                    )
                                  }
                                >
                                  Retry extraction
                                </PillButton>
                              ) : latestExtraction?.status === "pending" ||
                                latestExtraction?.status === "running" ? (
                                <PillButton
                                  size="compact"
                                  variant="secondary"
                                  disabled={workingProposalAction !== null}
                                  onClick={() =>
                                    void runProposalMutation(
                                      `cancel:${proposal._id}`,
                                      () =>
                                        cancelProposalExtraction({
                                          proposalId: proposal._id,
                                        }),
                                      "Proposal extraction cancelled",
                                      "Could not cancel proposal extraction",
                                    )
                                  }
                                >
                                  Cancel extraction
                                </PillButton>
                              ) : null}
                              {proposal.status !== "selected" &&
                              proposal.status !== "archived" ? (
                                <PillButton
                                  size="compact"
                                  variant="destructive"
                                  disabled={workingProposalAction !== null}
                                  onClick={() =>
                                    void runProposalMutation(
                                      `archive:${proposal._id}`,
                                      () =>
                                        archiveProposal({
                                          proposalId: proposal._id,
                                        }),
                                      "Proposal archived",
                                      "Could not archive the proposal",
                                    )
                                  }
                                >
                                  Archive
                                </PillButton>
                              ) : null}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </OperationalPanel>
          ) : null}
        </div>
      ) : null}

      {view === "market" ? (
        details.outreaches.length === 0 ? (
          <EmptyStateCard
            title="No brokers contacted yet"
            description="Add a broker from the network directory and track each response independently."
          />
        ) : outreachesWithoutProposal.length ? (
          <OperationalPanel as="section">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>Quote</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {outreachesWithoutProposal.map((outreach) => (
                  <TableRow key={outreach._id}>
                    <TableCell className="min-w-52 whitespace-normal">
                      <p
                        className={`text-foreground ${typeStyle("body.medium")}`}
                      >
                        {outreach.brokerName}
                      </p>
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {[outreach.contactName, outreach.contactEmail]
                          .filter(Boolean)
                          .join(" · ") || "No contact saved"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <OutreachStatusTag status={outreach.status} />
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal">
                      {outreach.applicationUrl ? (
                        <a
                          href={outreach.applicationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground underline underline-offset-4"
                        >
                          Open application
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No link</span>
                      )}
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {outreach.applicationQuestions.length} questions
                      </p>
                    </TableCell>
                    <TableCell className="min-w-52 whitespace-normal">
                      <p className="text-foreground">
                        {outreach.quoteAmount !== undefined
                          ? `${outreach.quoteCurrency ?? "USD"} ${outreach.quoteAmount.toLocaleString()}`
                          : outreach.quoteSummary
                            ? "Quote details saved"
                            : "Not received"}
                      </p>
                      {outreach.quoteUrl ? (
                        <a
                          href={outreach.quoteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`mt-1 inline-block text-muted-foreground underline underline-offset-4 ${typeStyle("caption.default")}`}
                        >
                          Open quote
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDisplayDate(outreach.updatedAt, "—")}
                    </TableCell>
                    <TableCell>
                      {readOnly ? null : (
                        <PillButton
                          type="button"
                          variant="icon"
                          iconOnly
                          label={`Edit ${outreach.brokerName}`}
                          onClick={() => openOutreachEditor(outreach)}
                        >
                          <Pencil className="size-3.5" />
                        </PillButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </OperationalPanel>
        ) : null
      ) : null}

      {view === "files" ? (
        details.files.length === 0 ? (
          <EmptyStateCard
            title="No procurement files yet"
            description="Upload client material or add a request for a document that still needs to be collected."
          />
        ) : (
          <OperationalPanel as="section">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File or request</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Broker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.files.map((item) => {
                  const file = item.clientFile;
                  const pdf = Boolean(
                    file &&
                    (file.contentType === "application/pdf" ||
                      /\.pdf$/i.test(file.name)),
                  );
                  const image = Boolean(
                    file &&
                    (file.contentType.startsWith("image/") ||
                      /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)),
                  );
                  return (
                    <TableRow key={item._id}>
                      <TableCell className="min-w-64 whitespace-normal">
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {image ? (
                              <FileImage className="size-4" />
                            ) : pdf ? (
                              <FileText className="size-4" />
                            ) : (
                              <File className="size-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            {file?.url && (pdf || image) ? (
                              <button
                                type="button"
                                onClick={() => previewFile(file)}
                                className={`block max-w-full truncate text-left text-foreground underline-offset-4 hover:underline ${typeStyle("body.medium")}`}
                              >
                                {item.label}
                              </button>
                            ) : file?.url ? (
                              <a
                                href={file.url}
                                download={file.name}
                                className={`block max-w-full truncate text-foreground underline-offset-4 hover:underline ${typeStyle("body.medium")}`}
                              >
                                {item.label}
                              </a>
                            ) : (
                              <span
                                className={`text-foreground ${typeStyle("body.medium")}`}
                              >
                                {item.label}
                              </span>
                            )}
                            {file ? (
                              <p
                                className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                              >
                                {item.sourceEmailMessageId ||
                                file.uploadedBySide === "procurement_email"
                                  ? "Email attachment"
                                  : "Operator upload"}
                                : {file.name}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {procurementFilePurposeLabel(item.purpose)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.outreachId
                          ? (outreachById.get(item.outreachId)?.brokerName ??
                            "Unknown")
                          : "General"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {procurementFileStatusLabel(item.status)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {[
                          item.clientVisible ? "Client" : null,
                          item.brokerRelease === "attached"
                            ? "Broker attachment"
                            : item.brokerRelease === "listed"
                              ? "Broker list"
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Private"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDisplayDate(item.updatedAt, "—")}
                      </TableCell>
                      <TableCell>
                        {readOnly ? null : (
                          <PillButton
                            type="button"
                            variant="icon"
                            iconOnly
                            label={`Edit ${item.label}`}
                            onClick={() => openFileEditor(item)}
                          >
                            <Pencil className="size-3.5" />
                          </PillButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </OperationalPanel>
        )
      ) : null}

      {view === "email" ? (
        <div className="space-y-4">
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Forward email to"
              verticalAlign="center"
              value={
                <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span
                    className={`min-w-0 break-all ${typeStyle("technical.codeCompact")}`}
                  >
                    {details.request.forwardingAddress}
                  </span>
                  <PillButton
                    type="button"
                    variant="secondary"
                    onClick={() => void copyAddress()}
                  >
                    <Copy className="size-3.5" />
                    Copy address
                  </PillButton>
                </div>
              }
            />
          </OperationalLabelValueList>
          {details.emailThreads.length === 0 ? (
            <EmptyStateCard
              title="No email imported for this request"
              description="Forward a thread to this request’s address. Original forwarded participants drive automatic categorization."
              icon={<Mail className="size-6" />}
            />
          ) : (
            <OperationalPanel as="section">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.emailThreads.map((email) => (
                    <TableRow key={email._id}>
                      <TableCell className="min-w-64 whitespace-normal">
                        <button
                          type="button"
                          onClick={() => openEmail(email._id)}
                          className={`text-left text-foreground underline-offset-4 hover:underline ${typeStyle("body.medium")}`}
                        >
                          {email.subject}
                        </button>
                        <p
                          className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {email.messageCount}{" "}
                          {email.messageCount === 1 ? "message" : "messages"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {email.participantEmails[0] ?? "Unknown"}
                      </TableCell>
                      <TableCell>
                        <EmailCategoryBadge category={email.category} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDisplayDateTime(email.latestMessageAt, "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </OperationalPanel>
          )}
        </div>
      ) : null}
    </div>
  );
}
