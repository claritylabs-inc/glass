"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import { FileText, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  extractQuestionGraphFromFields,
  flattenQuestionGraph,
  type ApplicationField,
  type ApplicationQuestionGraph,
} from "@claritylabs/cl-sdk/application";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FileDropZone } from "@/components/ui/file-drop";
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
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

type ApplicationStatus =
  | "draft"
  | "collecting"
  | "waiting_on_client"
  | "needs_broker_review"
  | "broker_ready"
  | "submitted"
  | "cancelled"
  | "stale";

type ApplicationRow = {
  _id: Id<"applicationIntakes">;
  orgId: string;
  clientName?: string;
  title: string;
  status: ApplicationStatus;
  lineOfBusiness?: string;
  product?: string;
  normalizedAnswers: ApplicationAnswerRow[];
  missingQuestions: ApplicationQuestionRow[];
  packetId?: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  submittedAt?: number;
};

type ApplicationAnswerRow = {
  fieldId: string;
  label: string;
  value: string;
  section?: string;
  source?: string;
  updatedAt?: number;
};

type ApplicationQuestionRow = {
  fieldId: string;
  label: string;
  prompt: string;
  required: boolean;
  section?: string;
};

type ApplicationPacketRow = {
  _id: string;
  status: "draft" | "broker_ready" | "submitted";
  missingFieldIds: string[];
  fileUrl?: string | null;
  createdAt: number;
  updatedAt?: number;
  submittedAt?: number;
};

type ApplicationTemplateStatus = "draft" | "active" | "archived";

type ApplicationTemplateRow = {
  _id: Id<"applicationTemplates">;
  title: string;
  version: string;
  applicationType?: string;
  lineOfBusiness?: string;
  product?: string;
  status: ApplicationTemplateStatus;
  sourceKind: "manual" | "pdf" | "imported" | "generated";
  questionGraph?: unknown;
  fieldCount: number;
  updatedAt: number;
};

type ApplicationDetail = ApplicationRow & {
  packets?: ApplicationPacketRow[];
};

type ApplicationPanelBusy = "answers" | "submit" | null;

type ClientRow = {
  clientOrgId?: string;
  name?: string;
  primaryContactEmail?: string;
  onboardingStatus?: string;
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  collecting: "Collecting",
  waiting_on_client: "Waiting",
  needs_broker_review: "Broker review",
  broker_ready: "Ready",
  submitted: "Submitted",
  cancelled: "Cancelled",
  stale: "Stale",
};

const TEMPLATE_STATUS_LABELS: Record<ApplicationTemplateStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const AD_HOC_TEMPLATE_VALUE = "__ad_hoc__";
const APPLICATION_SOURCE_ACCEPT =
  ".txt,.md,.markdown,.pdf,.docx,.csv,.json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json";

type BrokerApplicationTab = "applications" | "templates";

function statusVariant(status: ApplicationStatus): "default" | "secondary" | "outline" {
  if (status === "broker_ready") return "default";
  if (status === "submitted") return "outline";
  return "secondary";
}

function templateStatusVariant(status: ApplicationTemplateStatus): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

function formatTime(value: number) {
  return dayjs(value).format("MMM D, h:mm A");
}

function applicationSubtitle(row: ApplicationRow) {
  return [row.lineOfBusiness, row.product].filter(Boolean).join(" · ") || "Application";
}

function rowOwnerLabel(row: ApplicationRow, mode: "broker" | "client") {
  return row.clientName ?? (mode === "client" ? "This workspace" : "Client");
}

function parseTemplateFields(text: string): ApplicationField[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `field_${index + 1}`,
      label: line.replace(/[?.:]+$/g, "").slice(0, 100),
      section: "Application",
      fieldType: "text" as const,
      required: true,
    }));
}

function templateFields(template?: ApplicationTemplateRow | null) {
  if (!template?.questionGraph) return [];
  try {
    return flattenQuestionGraph(template.questionGraph as ApplicationQuestionGraph);
  } catch {
    return [];
  }
}

function buildTemplateQuestionGraph(args: {
  templateId: string;
  title: string;
  applicationType?: string;
  fields: ApplicationField[];
}) {
  const graph = extractQuestionGraphFromFields(args.fields, {
    id: `${args.templateId}:graph`,
    version: "v1",
    title: args.title,
    applicationType: args.applicationType ?? null,
    source: "manual",
  });
  return JSON.parse(JSON.stringify(graph)) as ApplicationQuestionGraph;
}

function answerFields(detail: {
  normalizedAnswers: ApplicationAnswerRow[];
  missingQuestions: ApplicationQuestionRow[];
}) {
  const fields = new Map<
    string,
    {
      fieldId: string;
      label: string;
      section?: string;
      prompt?: string;
      currentValue: string;
    }
  >();

  for (const answer of detail.normalizedAnswers) {
    fields.set(answer.fieldId, {
      fieldId: answer.fieldId,
      label: answer.label,
      section: answer.section,
      currentValue: answer.value,
    });
  }
  for (const question of detail.missingQuestions) {
    fields.set(question.fieldId, {
      fieldId: question.fieldId,
      label: question.label,
      section: question.section,
      prompt: question.prompt,
      currentValue: fields.get(question.fieldId)?.currentValue ?? "",
    });
  }

  return [...fields.values()];
}

function currentPacket(packets: ApplicationPacketRow[] | undefined, packetId?: string) {
  if (!packetId || !packets?.length) return null;
  return packets.find((packet) => packet._id === packetId) ?? null;
}

function applicationHeaderInfo(detail: ApplicationDetail) {
  return [
    detail.clientName ?? "Client",
    applicationSubtitle(detail),
    `Updated ${formatTime(detail.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function canEditApplicationAnswers(detail: ApplicationDetail, viewerIsBroker: boolean) {
  if (viewerIsBroker) return false;
  return !["broker_ready", "submitted", "cancelled"].includes(detail.status);
}

function canSubmitApplicationAnswers(detail: ApplicationDetail, viewerIsBroker: boolean) {
  if (viewerIsBroker) return false;
  if (["broker_ready", "submitted", "cancelled"].includes(detail.status)) return false;
  return detail.missingQuestions.length === 0 && answerFields(detail).length > 0;
}

function jsonFileName(detail: ApplicationDetail) {
  const safeTitle = detail.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeTitle || "application"}-answers.json`;
}

function DownloadLink({
  children,
  download,
  href,
}: {
  children: ReactNode;
  download?: string;
  href: string;
}) {
  return (
    <a
      className="inline-flex min-h-8 w-full shrink-0 items-center justify-center rounded-full border border-foreground/8 bg-transparent px-5 py-2 text-label font-medium leading-none text-muted-foreground transition-colors hover:border-foreground/14 hover:bg-foreground/[0.03] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/10 sm:min-h-7 sm:w-auto sm:py-1"
      download={download}
      href={href}
      rel="noreferrer"
      target={download ? undefined : "_blank"}
    >
      {children}
    </a>
  );
}

function ApplicationAnswersPanel({
  applicationId,
  detail,
  fields,
  editable,
  busy,
  setBusy,
}: {
  applicationId: Id<"applicationIntakes">;
  detail: ApplicationDetail;
  fields: ReturnType<typeof answerFields>;
  editable: boolean;
  busy: ApplicationPanelBusy;
  setBusy: (busy: ApplicationPanelBusy) => void;
}) {
  const recordAnswers = useMutation(api.applicationIntakes.recordAnswers);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.fieldId, field.currentValue])),
  );
  const lastSubmittedSignatureRef = useRef<string | null>(null);
  const changedAnswers = useMemo(() => {
    const existing = new Map(detail.normalizedAnswers.map((answer) => [answer.fieldId, answer.value]));
    return fields
      .map((field) => ({
        field,
        value: (answerDrafts[field.fieldId] ?? "").trim(),
      }))
      .filter(({ field, value }) => value && value !== (existing.get(field.fieldId) ?? ""))
      .map(({ field, value }) => ({
        fieldId: field.fieldId,
        label: field.label,
        section: field.section,
        value,
        source: "client_portal",
      }));
  }, [answerDrafts, detail.normalizedAnswers, fields]);

  useEffect(() => {
    if (!editable || changedAnswers.length === 0 || busy !== null) return;
    const signature = JSON.stringify({
      answers: changedAnswers,
    });
    if (lastSubmittedSignatureRef.current === signature) return;
    const timeout = window.setTimeout(() => {
      lastSubmittedSignatureRef.current = signature;
      setBusy("answers");
      void recordAnswers({
        applicationIntakeId: applicationId,
        sourceKind: "web",
        answers: changedAnswers,
      })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unable to save answers";
          toast.error(message);
        })
        .finally(() => {
          setBusy(null);
        });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [applicationId, busy, changedAnswers, editable, recordAnswers, setBusy]);

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Answers" />
      {editable && fields.length > 0 ? (
        fields.map((field, index) => (
          <OperationalItem key={field.fieldId} className={index === 0 ? "border-t-0" : undefined}>
            <label className="flex flex-col gap-2">
              <span className="text-base font-medium text-foreground">
                {field.label}
              </span>
              {field.prompt && field.prompt !== field.label ? (
                <span className="text-base text-muted-foreground">{field.prompt}</span>
              ) : null}
              <Textarea
                value={answerDrafts[field.fieldId] ?? ""}
                onChange={(event) =>
                  setAnswerDrafts((drafts) => ({
                    ...drafts,
                    [field.fieldId]: event.target.value,
                  }))
                }
                className="min-h-20 resize-none"
              />
            </label>
          </OperationalItem>
        ))
      ) : detail.normalizedAnswers.length > 0 || detail.missingQuestions.length > 0 ? (
        <>
          {detail.normalizedAnswers.map((answer, index) => (
            <OperationalItem key={answer.fieldId} className={index === 0 ? "border-t-0" : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-medium text-foreground">{answer.label}</p>
                  <p className="mt-1 break-words text-base text-muted-foreground">{answer.value}</p>
                </div>
                {answer.section ? (
                  <span className="shrink-0 text-label text-muted-foreground">{answer.section}</span>
                ) : null}
              </div>
            </OperationalItem>
          ))}
          {detail.missingQuestions.map((question, index) => (
            <OperationalItem
              key={question.fieldId}
              className={detail.normalizedAnswers.length === 0 && index === 0 ? "border-t-0" : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-medium text-foreground">{question.label}</p>
                  <p className="mt-1 break-words text-base text-muted-foreground">Not answered</p>
                </div>
                {question.section ? (
                  <span className="shrink-0 text-label text-muted-foreground">{question.section}</span>
                ) : null}
              </div>
            </OperationalItem>
          ))}
        </>
      ) : (
        <OperationalItem className="border-t-0">
          <p className="text-base text-muted-foreground">No answers recorded.</p>
        </OperationalItem>
      )}
    </OperationalPanel>
  );
}

function ApplicationCreateDrawer({
  open,
  onOpenChange,
  mode,
  fixedClientOrgId,
  clients,
  templates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "broker" | "client";
  fixedClientOrgId?: string;
  clients: ClientRow[];
  templates: ApplicationTemplateRow[];
}) {
  const [clientOrgId, setClientOrgId] = useState(fixedClientOrgId ?? "");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("Insurance application");
  const [lineOfBusiness, setLineOfBusiness] = useState("");
  const [product, setProduct] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [formattedQuestions, setFormattedQuestions] = useState<ApplicationQuestionRow[]>([]);
  const [questionFormatError, setQuestionFormatError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const formatRunRef = useRef(0);
  const sourceSignatureRef = useRef("");
  const lastFormattedSignatureRef = useRef<string | null>(null);
  const start = useMutation(api.applicationIntakes.start);
  const generateUploadUrl = useMutation(api.applicationIntakes.generateUploadUrl);
  const formatQuestions = useAction(api.actions.applicationIntakeAuthoring.formatQuestions);

  const targetOrgId = fixedClientOrgId ?? clientOrgId;
  const activeTemplates = templates.filter((template) => template.status === "active");
  const selectedTemplate = activeTemplates.find((template) => template._id === templateId);
  const selectedTemplateId = selectedTemplate?._id;
  const hasQuestionSource = Boolean(
    questionText.trim() || questionFile || formattedQuestions.length > 0,
  );
  const canSubmit = Boolean(
    targetOrgId && title.trim() && (selectedTemplate || hasQuestionSource),
  );
  const questionSourceText = questionText.trim();
  const sourceSignature =
    !targetOrgId || selectedTemplateId || (!questionSourceText && !questionFile)
      ? ""
      : JSON.stringify({
          orgId: targetOrgId,
          sourceText: questionSourceText,
          fileName: questionFile?.name ?? "",
          fileSize: questionFile?.size ?? 0,
          fileLastModified: questionFile?.lastModified ?? 0,
          lineOfBusiness: lineOfBusiness.trim(),
          product: product.trim(),
        });

  useEffect(() => {
    sourceSignatureRef.current = sourceSignature;
  }, [sourceSignature]);

  function chooseTemplate(nextTemplateId: string) {
    if (nextTemplateId === AD_HOC_TEMPLATE_VALUE) {
      setTemplateId("");
      setQuestionFormatError(null);
      lastFormattedSignatureRef.current = null;
      return;
    }
    setTemplateId(nextTemplateId);
    setQuestionText("");
    setQuestionFile(null);
    setFormattedQuestions([]);
    setQuestionFormatError(null);
    lastFormattedSignatureRef.current = null;
    const template = activeTemplates.find((item) => item._id === nextTemplateId);
    if (!template) return;
    setTitle(template.title);
    setLineOfBusiness(template.lineOfBusiness ?? "");
    setProduct(template.product ?? "");
  }

  function updateQuestionText(value: string) {
    setQuestionText(value);
    setFormattedQuestions([]);
    setQuestionFormatError(null);
    lastFormattedSignatureRef.current = null;
  }

  function updateQuestionFile(file: File | null) {
    setQuestionFile(file);
    setFormattedQuestions([]);
    setQuestionFormatError(null);
    lastFormattedSignatureRef.current = null;
  }

  const formatQuestionSource = useCallback(
    async ({ signature = sourceSignatureRef.current }: { signature?: string } = {}) => {
      if (!targetOrgId) throw new Error("Choose a client first");
      if (!questionText.trim() && !questionFile) {
        throw new Error("Paste questions or upload an application document first");
      }

      const runId = formatRunRef.current + 1;
      formatRunRef.current = runId;
      setFormatting(true);
      setQuestionFormatError(null);
      try {
        let fileId: Id<"_storage"> | undefined;
        if (questionFile) {
          const uploadUrl = await generateUploadUrl({
            orgId: targetOrgId as Id<"organizations">,
          });
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": questionFile.type || "application/octet-stream",
            },
            body: questionFile,
          });
          if (!response.ok) throw new Error("Application document upload failed");
          const payload = (await response.json()) as { storageId: string };
          fileId = payload.storageId as Id<"_storage">;
        }

        const result = await formatQuestions({
          orgId: targetOrgId as Id<"organizations">,
          pastedText: questionText.trim() || undefined,
          fileId,
          fileName: questionFile?.name,
          contentType: questionFile?.type,
          lineOfBusiness: lineOfBusiness.trim() || undefined,
          product: product.trim() || undefined,
        }) as { questions: ApplicationQuestionRow[] };
        if (!signature || signature === sourceSignatureRef.current) {
          setFormattedQuestions(result.questions);
          lastFormattedSignatureRef.current = signature || sourceSignatureRef.current;
        }
        return result.questions;
      } catch (error) {
        if (!signature || signature === sourceSignatureRef.current) {
          setQuestionFormatError(error instanceof Error ? error.message : "Unable to format questions");
        }
        throw error;
      } finally {
        if (runId === formatRunRef.current) {
          setFormatting(false);
        }
      }
    },
    [
      formatQuestions,
      generateUploadUrl,
      lineOfBusiness,
      product,
      questionFile,
      questionText,
      targetOrgId,
    ],
  );

  useEffect(() => {
    if (!open || selectedTemplateId || submitting || !sourceSignature) return;
    if (lastFormattedSignatureRef.current === sourceSignature) return;
    const timeout = window.setTimeout(() => {
      void formatQuestionSource({ signature: sourceSignature }).catch(() => {});
    }, questionFile ? 250 : 1200);
    return () => window.clearTimeout(timeout);
  }, [
    formatQuestionSource,
    open,
    questionFile,
    selectedTemplateId,
    sourceSignature,
    submitting,
  ]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const missingQuestions = selectedTemplate
        ? undefined
        : formattedQuestions.length > 0
          ? formattedQuestions
          : await formatQuestionSource();
      await start({
        orgId: targetOrgId as Id<"organizations">,
        templateId: selectedTemplate?._id,
        sourceKind: "broker_portal",
        title: title.trim(),
        lineOfBusiness: lineOfBusiness.trim() || undefined,
        product: product.trim() || undefined,
        missingQuestions,
      });
      toast.success("Application intake started");
      onOpenChange(false);
      setQuestionText("");
      setQuestionFile(null);
      setFormattedQuestions([]);
      setQuestionFormatError(null);
      setTemplateId("");
      if (!fixedClientOrgId) setClientOrgId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Start application"
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </PillButton>
          <PillButton type="button" disabled={!canSubmit || submitting || formatting} onClick={submit}>
            Start intake
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === "broker" && !fixedClientOrgId ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Client</span>
            <Select value={clientOrgId} onValueChange={(value) => setClientOrgId(value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>{clients.find((client) => client.clientOrgId === clientOrgId)?.name ?? "Choose client"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients
                  .filter((client) => client.clientOrgId)
                  .map((client) => (
                    <SelectItem key={client.clientOrgId} value={client.clientOrgId!}>
                      {client.name ?? "Client"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        {activeTemplates.length > 0 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Template</span>
            <Select
              value={templateId || AD_HOC_TEMPLATE_VALUE}
              onValueChange={(value) => chooseTemplate(value ?? AD_HOC_TEMPLATE_VALUE)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{selectedTemplate?.title ?? "Ad hoc intake"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AD_HOC_TEMPLATE_VALUE}>Ad hoc intake</SelectItem>
                {activeTemplates.map((template) => (
                  <SelectItem key={template._id} value={template._id}>
                    {template.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Line</span>
            <input
              value={lineOfBusiness}
              onChange={(event) => setLineOfBusiness(event.target.value)}
              placeholder="General liability"
              className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Product</span>
            <input
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="Carrier or product"
              className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
            />
          </label>
        </div>

        {selectedTemplate ? (
          <OperationalPanel>
            <OperationalPanelHeader
              title={selectedTemplate.title}
              description={`${selectedTemplate.fieldCount} field${selectedTemplate.fieldCount === 1 ? "" : "s"}`}
              action={<Badge variant={templateStatusVariant(selectedTemplate.status)}>Active</Badge>}
            />
          </OperationalPanel>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-muted-foreground">Questions</span>
              <Textarea
                value={questionText}
                onChange={(event) => updateQuestionText(event.target.value)}
                rows={8}
                placeholder="Paste application questions or carrier application text"
                className="min-h-40 resize-none"
                disabled={submitting}
              />
            </label>
            <FileDropZone
              accept={APPLICATION_SOURCE_ACCEPT}
              disabled={submitting}
              idleLabel="Upload application document"
              busyLabel="Starting intake..."
              hint="PDF, DOCX, TXT, Markdown, CSV, or JSON"
              padding="px-4 py-5"
              onFile={updateQuestionFile}
            />
            {questionFile ? (
              <OperationalPanel as="div" className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-foreground">{questionFile.name}</p>
                  <p className="text-label text-muted-foreground">
                    {(questionFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <PillButton
                  type="button"
                  size="compact"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => updateQuestionFile(null)}
                >
                  Remove
                </PillButton>
              </OperationalPanel>
            ) : null}
            {formatting ? (
              <p className="text-label text-muted-foreground">Formatting questions...</p>
            ) : questionFormatError ? (
              <p className="text-label text-destructive">{questionFormatError}</p>
            ) : null}
            {formattedQuestions.length > 0 ? (
              <OperationalPanel>
                <OperationalPanelHeader
                  title="Formatted questions"
                  description={`${formattedQuestions.length} question${formattedQuestions.length === 1 ? "" : "s"}`}
                />
                {formattedQuestions.map((question, index) => (
                  <OperationalItem
                    key={question.fieldId}
                    className={index === 0 ? "border-t-0" : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-foreground">{question.label}</p>
                        {question.prompt !== question.label ? (
                          <p className="mt-1 text-base text-muted-foreground">{question.prompt}</p>
                        ) : null}
                      </div>
                      {question.section ? (
                        <span className="shrink-0 text-label text-muted-foreground">
                          {question.section}
                        </span>
                      ) : null}
                    </div>
                  </OperationalItem>
                ))}
              </OperationalPanel>
            ) : null}
          </>
        )}
      </div>
    </SettingsDrawer>
  );
}

function ApplicationTemplateDrawer({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ApplicationTemplateRow | null;
}) {
  const saveTemplate = useMutation(api.applicationIntakes.saveTemplate);
  const existingFields = templateFields(template);
  const [title, setTitle] = useState(template?.title ?? "General liability application");
  const [lineOfBusiness, setLineOfBusiness] = useState(template?.lineOfBusiness ?? "");
  const [product, setProduct] = useState(template?.product ?? "");
  const [status, setStatus] = useState<ApplicationTemplateStatus>(template?.status ?? "active");
  const [questionText, setQuestionText] = useState(
    existingFields.map((field) => field.label).join("\n"),
  );
  const [submitting, setSubmitting] = useState(false);
  const fields = parseTemplateFields(questionText);
  const canSubmit = Boolean(title.trim() && fields.length > 0);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await saveTemplate({
        templateId: template?._id,
        title: title.trim(),
        version: template?.version,
        applicationType: lineOfBusiness.trim() || undefined,
        lineOfBusiness: lineOfBusiness.trim() || undefined,
        product: product.trim() || undefined,
        status,
        sourceKind: "manual",
        questionGraph: buildTemplateQuestionGraph({
          templateId: template?._id ?? `manual:${dayjs().valueOf()}`,
          title: title.trim(),
          applicationType: lineOfBusiness.trim() || undefined,
          fields,
        }),
      });
      toast.success(template ? "Template updated" : "Template created");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save template");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Edit template" : "New template"}
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </PillButton>
          <PillButton type="button" disabled={!canSubmit || submitting} onClick={submit}>
            Save template
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Line</span>
            <input
              value={lineOfBusiness}
              onChange={(event) => setLineOfBusiness(event.target.value)}
              placeholder="General liability"
              className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-muted-foreground">Product</span>
            <input
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="Primary GL"
              className="h-9 rounded-md border border-foreground/10 bg-background px-3 text-base outline-none focus:border-foreground/30"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Status</span>
          <Select value={status} onValueChange={(value) => setStatus(value as ApplicationTemplateStatus)}>
            <SelectTrigger className="w-full">
              <SelectValue>{TEMPLATE_STATUS_LABELS[status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Fields</span>
          <Textarea
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            placeholder="One required field per line"
            className="min-h-40 resize-none"
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

function ApplicationReviewDrawer({
  applicationId,
  viewerIsBroker,
  onClose,
}: {
  applicationId: Id<"applicationIntakes"> | null;
  viewerIsBroker: boolean;
  onClose: () => void;
}) {
  const detail = useCachedQuery(
    "applicationIntakes.get",
    api.applicationIntakes.get,
    applicationId ? { applicationIntakeId: applicationId } : "skip",
  ) as ApplicationDetail | undefined;
  const preparePacket = useMutation(api.applicationIntakes.preparePacket);
  const [busy, setBusy] = useState<ApplicationPanelBusy>(null);
  const fields = useMemo(() => (detail ? answerFields(detail) : []), [detail]);
  const packet = currentPacket(detail?.packets, detail?.packetId);
  const editableAnswers = detail ? canEditApplicationAnswers(detail, viewerIsBroker) : false;
  const canSubmitAnswers = detail ? canSubmitApplicationAnswers(detail, viewerIsBroker) : false;
  const jsonHref = detail ? `/api/application-intakes/${detail._id}/answers` : null;

  const footer = detail && viewerIsBroker && detail.normalizedAnswers.length > 0 ? (
    <>
      {packet?.fileUrl ? (
        <DownloadLink href={packet.fileUrl}>
          Download filled PDF
        </DownloadLink>
      ) : null}
      {jsonHref ? (
        <DownloadLink download={jsonFileName(detail)} href={jsonHref}>
          Download JSON
        </DownloadLink>
      ) : null}
    </>
  ) : detail && !viewerIsBroker && !["broker_ready", "submitted", "cancelled"].includes(detail.status) ? (
    <PillButton type="button" disabled={!canSubmitAnswers || busy !== null} onClick={submitAnswers}>
      Submit answers
    </PillButton>
  ) : null;

  async function submitAnswers() {
    if (!applicationId) return;
    setBusy("submit");
    try {
      await preparePacket({ applicationIntakeId: applicationId });
      toast.success("Answers submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit answers");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsDrawer
      open={Boolean(applicationId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        detail ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-medium text-foreground">{detail.title}</span>
            <span className="truncate text-base font-normal text-muted-foreground">
              {applicationHeaderInfo(detail)}
            </span>
          </div>
        ) : (
          "Application"
        )
      }
      actions={
        detail ? (
          <Badge variant={statusVariant(detail.status)}>{STATUS_LABELS[detail.status]}</Badge>
        ) : null
      }
      footer={footer}
    >
      {!detail ? (
        <OperationalSkeletonList rows={5} showTrailing={false} />
      ) : (
        <div className="flex flex-col gap-4">
          <ApplicationAnswersPanel
            key={`${detail._id}:${detail.updatedAt}`}
            applicationId={detail._id}
            detail={detail}
            fields={fields}
            editable={editableAnswers}
            busy={busy}
            setBusy={setBusy}
          />
        </div>
      )}
    </SettingsDrawer>
  );
}

export function ApplicationIntakePage({
  mode,
  clientOrgId,
  onRightPanelChange,
  onActionsChange,
}: {
  mode: "broker" | "client";
  clientOrgId?: string;
  onRightPanelChange?: (node: ReactNode) => void;
  onActionsChange?: (node: ReactNode) => void;
}) {
  const currentOrg = useCurrentOrg();
  const searchParams = useSearchParams();
  const requestedApplicationId = searchParams.get("applicationId");
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ApplicationTemplateRow | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"applicationIntakes"> | null>(null);
  const [dismissedApplicationParam, setDismissedApplicationParam] = useState<string | null>(null);
  const [brokerTab, setBrokerTab] = useState<BrokerApplicationTab>("applications");

  const clients = useCachedQuery(
    "clients.listForBroker.applications",
    api.clients.listForBroker,
    mode === "broker" && currentOrg?.isBroker
      ? { brokerOrgId: currentOrg.orgId as Id<"organizations"> }
      : "skip",
  ) as ClientRow[] | undefined;

  const rows = useCachedQuery(
    mode === "broker" ? "applicationIntakes.listForBroker" : "applicationIntakes.listForClient",
    mode === "broker"
      ? api.applicationIntakes.listForBroker
      : api.applicationIntakes.listForClient,
    mode === "broker"
      ? currentOrg?.isBroker
        ? {}
        : "skip"
      : clientOrgId
        ? { orgId: clientOrgId as Id<"organizations"> }
        : "skip",
  ) as ApplicationRow[] | undefined;

  const templates = useCachedQuery(
    "applicationIntakes.listTemplates.applications",
    api.applicationIntakes.listTemplates,
    currentOrg?.isBroker ? {} : "skip",
  ) as ApplicationTemplateRow[] | undefined;

  const applicationRows = rows ?? [];
  const clientRows = useMemo(() => clients ?? [], [clients]);
  const templateRows = useMemo(() => templates ?? [], [templates]);
  const ownerLabelMode = currentOrg?.isBroker ? "broker" : "client";
  const showBrokerTabs = mode === "broker" && Boolean(currentOrg?.isBroker);
  const routeSelectedId = useMemo(() => {
    if (!requestedApplicationId || dismissedApplicationParam === requestedApplicationId) return null;
    return rows?.find((row) => String(row._id) === requestedApplicationId)?._id ?? null;
  }, [dismissedApplicationParam, requestedApplicationId, rows]);
  const activeSelectedId = selectedId ?? routeSelectedId;

  const rightPanel = useMemo(() => {
    if (templateOpen) {
      return (
        <ApplicationTemplateDrawer
          key={editingTemplate?._id ?? "new-template"}
          open={templateOpen}
          onOpenChange={(open) => {
            setTemplateOpen(open);
            if (!open) setEditingTemplate(null);
          }}
          template={editingTemplate}
        />
      );
    }
    if (createOpen) {
      return (
        <ApplicationCreateDrawer
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode={mode}
          fixedClientOrgId={clientOrgId}
          clients={clientRows}
          templates={templateRows}
        />
      );
    }
    if (activeSelectedId) {
      return (
        <ApplicationReviewDrawer
          applicationId={activeSelectedId}
          viewerIsBroker={Boolean(currentOrg?.isBroker)}
          onClose={() => {
            if (routeSelectedId && requestedApplicationId) {
              setDismissedApplicationParam(requestedApplicationId);
            }
            setSelectedId(null);
          }}
        />
      );
    }
    return null;
  }, [
    clientOrgId,
    clientRows,
    createOpen,
    currentOrg?.isBroker,
    editingTemplate,
    mode,
    activeSelectedId,
    requestedApplicationId,
    routeSelectedId,
    templateOpen,
    templateRows,
  ]);

  useEffect(() => {
    onRightPanelChange?.(rightPanel);
  }, [onRightPanelChange, rightPanel]);

  useEffect(() => {
    return () => onRightPanelChange?.(null);
  }, [onRightPanelChange]);

  const headerActions = useMemo(() => {
    if (mode === "broker" && currentOrg?.isBroker && brokerTab === "templates") {
      return (
        <PillButton
          size="compact"
          variant="primary"
          onClick={() => {
            setEditingTemplate(null);
            setTemplateOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New template
        </PillButton>
      );
    }
    const canStartApplication = mode === "client" ? Boolean(clientOrgId) : Boolean(currentOrg?.isBroker);
    if (!canStartApplication) return null;
    return (
      <PillButton size="compact" variant="primary" onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Start application
      </PillButton>
    );
  }, [brokerTab, clientOrgId, currentOrg?.isBroker, mode]);

  useEffect(() => {
    onActionsChange?.(headerActions);
  }, [headerActions, onActionsChange]);

  useEffect(() => {
    return () => onActionsChange?.(null);
  }, [onActionsChange]);

  if (mode === "broker" && currentOrg && !currentOrg.isBroker) {
    return (
      <div className="py-16">
        <EmptyStateCard
          title="Broker workspace required"
          description="Applications are managed from broker workspaces or client detail pages."
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {showBrokerTabs ? (
          <Tabs value={brokerTab} onValueChange={(value) => setBrokerTab(value as BrokerApplicationTab)}>
            <TabsList variant="pill" className="max-w-full">
              <TabsTrigger value="applications">
                Applications
                <span className="text-muted-foreground/60">{applicationRows.length}</span>
              </TabsTrigger>
              <TabsTrigger value="templates">
                Templates
                <span className="text-muted-foreground/60">{templateRows.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {showBrokerTabs && brokerTab === "templates" ? (
          templates === undefined ? (
            <OperationalSkeletonList rows={3} showTrailing={false} />
          ) : templateRows.length === 0 ? (
            <EmptyStateCard
              icon={<FileText className="h-7 w-7" />}
              title="No templates"
              description="Create reusable field sets for carrier applications, renewal requests, and broker submissions."
            />
          ) : (
            <OperationalPanel>
              {templateRows.slice(0, 100).map((template) => (
                <OperationalItem key={template._id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-foreground">{template.title}</p>
                      <p className="mt-0.5 truncate text-base text-muted-foreground">
                        {[template.lineOfBusiness, template.product].filter(Boolean).join(" · ") ||
                          `${template.fieldCount} field${template.fieldCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={templateStatusVariant(template.status)}>
                        {TEMPLATE_STATUS_LABELS[template.status]}
                      </Badge>
                      <PillButton
                        type="button"
                        size="compact"
                        variant="secondary"
                        onClick={() => {
                          setEditingTemplate(template);
                          setTemplateOpen(true);
                        }}
                      >
                        Edit
                      </PillButton>
                    </div>
                  </div>
                </OperationalItem>
              ))}
            </OperationalPanel>
          )
        ) : rows === undefined ? (
          <OperationalSkeletonList rows={7} />
        ) : applicationRows.length === 0 ? (
          <EmptyStateCard
            icon={<FileText className="h-7 w-7" />}
            title="No applications"
            description={
              mode === "client"
                ? "Start an intake from an application PDF, email, text, web chat, or portal request."
                : "Start an intake from a broker request, client email, chat, or MCP workflow."
            }
          />
        ) : (
          <>
            <OperationalPanel data-applications-mobile-list className="block sm:hidden">
              {applicationRows.map((row) => (
                <button
                  key={row._id}
                  type="button"
                  data-application-id={row._id}
                  onClick={() => setSelectedId(row._id)}
                  className="flex w-full flex-col gap-3 border-t border-foreground/6 px-4 py-3 text-left first:border-t-0"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-foreground">{row.title}</p>
                      <p className="mt-0.5 truncate text-base text-muted-foreground">
                        {applicationSubtitle(row)}
                      </p>
                    </div>
                    <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-base text-muted-foreground">
                    <span className="min-w-0 truncate">{rowOwnerLabel(row, ownerLabelMode)}</span>
                    <span className="shrink-0">
                      {row.normalizedAnswers.length} /{" "}
                      {row.normalizedAnswers.length + row.missingQuestions.length}
                    </span>
                  </div>
                </button>
              ))}
            </OperationalPanel>
            <OperationalPanel data-applications-desktop-table className="hidden sm:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Application</TableHead>
                      <TableHead>{ownerLabelMode === "broker" ? "Client" : "Workspace"}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Answers</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applicationRows.map((row) => (
                      <TableRow
                        key={row._id}
                        data-application-id={row._id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(row._id)}
                      >
                        <TableCell>
                          <div className="min-w-48">
                            <p className="font-medium text-foreground">{row.title}</p>
                            <p className="text-base text-muted-foreground">
                              {applicationSubtitle(row)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{rowOwnerLabel(row, ownerLabelMode)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.normalizedAnswers.length} / {row.normalizedAnswers.length + row.missingQuestions.length}
                        </TableCell>
                        <TableCell>{formatTime(row.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </OperationalPanel>
          </>
        )}
      </div>

      {onRightPanelChange ? null : rightPanel}
    </>
  );
}
