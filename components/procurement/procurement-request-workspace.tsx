"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
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
  type ProcurementFilePurpose,
  type ProcurementFileStatus,
  type ProcurementOutreachStatus,
  type ProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
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
const EXTERNAL_BROKER = "__external__";

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
  uploadedBySide: "operator" | "procurement_email";
};

type RequestSummary = {
  _id: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  requestSummary: string;
  requirements: string;
  targetEffectiveDate?: string;
  status: ProcurementRequestStatus;
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  forwardingAddress: string;
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
  const [requestSummary, setRequestSummary] = useState(request.requestSummary);
  const [requirements, setRequirements] = useState(request.requirements);
  const [targetEffectiveDate, setTargetEffectiveDate] = useState(
    request.targetEffectiveDate ?? "",
  );
  const [status, setStatus] = useState(request.status);
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
        requestSummary,
        requirements,
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
            value={requestSummary}
            onChange={(event) => setRequestSummary(event.target.value)}
            className="min-h-24"
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Requirements
          </span>
          <Textarea
            value={requirements}
            onChange={(event) => setRequirements(event.target.value)}
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
  const [brokerOrgId, setBrokerOrgId] = useState(
    outreach?.brokerOrgId ?? EXTERNAL_BROKER,
  );
  const [brokerName, setBrokerName] = useState(outreach?.brokerName ?? "");
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
    if (broker) setBrokerName(broker.name);
  }

  async function save() {
    if (!brokerName.trim()) {
      toast.error("Enter a broker name");
      return;
    }
    const shared = {
      brokerName,
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
          brokerOrgId:
            brokerOrgId === EXTERNAL_BROKER
              ? null
              : (brokerOrgId as Id<"organizations">),
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
          brokerOrgId:
            brokerOrgId === EXTERNAL_BROKER
              ? undefined
              : (brokerOrgId as Id<"organizations">),
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
              options={[
                { value: EXTERNAL_BROKER, label: "External / unlinked broker" },
                ...brokers.map((broker) => ({
                  value: broker._id,
                  label: broker.name,
                })),
              ]}
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Broker name
            </span>
            <Input
              value={brokerName}
              onChange={(event) => setBrokerName(event.target.value)}
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
  view: "overview" | "brokers" | "files" | "email";
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
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
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
          outreaches={details.outreaches}
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
      ) : view === "brokers" ? (
        <PillButton type="button" onClick={() => openOutreachEditor()}>
          <Plus className="size-3.5" />
          Add broker
        </PillButton>
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

  if (
    result === undefined ||
    policies === undefined ||
    policyRows === undefined ||
    clientFilesResult === undefined ||
    requestRows === undefined ||
    brokers === undefined
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
            <TabsTrigger value="brokers">
              Brokers
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
              Email
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
              label="Status"
              value={<RequestStatusTag status={details.request.status} />}
            />
            <OperationalLabelValueRow
              label="Target effective date"
              value={formatDisplayDate(
                details.request.targetEffectiveDate,
                "Not set",
              )}
            />
            <OperationalLabelValueRow
              label="Replacing"
              value={details.request.replacingPolicy?.label ?? "No policy"}
            />
            <OperationalLabelValueRow
              label="Resulting policy"
              value={details.request.resultingPolicy?.label ?? "Not linked"}
            />
            <OperationalLabelValueRow
              label="Updated"
              value={formatDisplayDate(details.request.updatedAt, "—")}
            />
          </OperationalLabelValueList>
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="What the client asked for"
              layout="stacked"
              value={
                <span className="whitespace-pre-wrap">
                  {details.request.requestSummary}
                </span>
              }
            />
            <OperationalLabelValueRow
              label="Procurement requirements"
              layout="stacked"
              value={
                <span className="whitespace-pre-wrap">
                  {details.request.requirements}
                </span>
              }
            />
          </OperationalLabelValueList>
        </div>
      ) : null}

      {view === "brokers" ? (
        details.outreaches.length === 0 ? (
          <EmptyStateCard
            title="No brokers contacted yet"
            description="Add provisioned or external brokers and track each response independently."
          />
        ) : (
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
                {details.outreaches.map((outreach) => (
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
        )
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
