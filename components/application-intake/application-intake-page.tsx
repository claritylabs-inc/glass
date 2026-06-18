"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { FileCheck2, FileText, PackageCheck, Plus } from "lucide-react";
import { toast } from "sonner";

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
  normalizedAnswers: Array<{ fieldId: string; label: string; value: string; section?: string }>;
  missingQuestions: Array<{ fieldId: string; label: string; prompt: string; required: boolean; section?: string }>;
  packetId?: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
};

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
  needs_broker_review: "Review",
  broker_ready: "Packet ready",
  submitted: "Submitted",
  cancelled: "Cancelled",
  stale: "Stale",
};

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "collecting", label: "Collecting" },
  { value: "needs_broker_review", label: "Review" },
  { value: "broker_ready", label: "Ready" },
  { value: "submitted", label: "Submitted" },
] as const;

function statusVariant(status: ApplicationStatus): "default" | "secondary" | "outline" {
  if (status === "broker_ready") return "default";
  if (status === "submitted") return "outline";
  return "secondary";
}

function formatTime(value: number) {
  return dayjs(value).format("MMM D, h:mm A");
}

function applicationSubtitle(row: ApplicationRow) {
  return [row.lineOfBusiness, row.product].filter(Boolean).join(" · ") || "Application";
}

function parseQuestions(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      fieldId: `manual_${index + 1}`,
      label: line.replace(/[?.:]+$/g, "").slice(0, 80),
      prompt: line,
      required: true,
    }));
}

function ApplicationCreateDrawer({
  open,
  onOpenChange,
  mode,
  fixedClientOrgId,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "broker" | "client";
  fixedClientOrgId?: string;
  clients: ClientRow[];
}) {
  const [clientOrgId, setClientOrgId] = useState(fixedClientOrgId ?? "");
  const [title, setTitle] = useState("Insurance application");
  const [lineOfBusiness, setLineOfBusiness] = useState("");
  const [product, setProduct] = useState("");
  const [requestText, setRequestText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const start = useMutation(api.applicationIntakes.start);

  const targetOrgId = fixedClientOrgId ?? clientOrgId;
  const canSubmit = Boolean(targetOrgId && title.trim() && requestText.trim());

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await start({
        orgId: targetOrgId as Id<"organizations">,
        sourceKind: "broker_portal",
        title: title.trim(),
        lineOfBusiness: lineOfBusiness.trim() || undefined,
        product: product.trim() || undefined,
        requestText: requestText.trim(),
        missingQuestions: parseQuestions(questionText),
      });
      toast.success("Application intake started");
      onOpenChange(false);
      setRequestText("");
      setQuestionText("");
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
          <PillButton type="button" disabled={!canSubmit || submitting} onClick={submit}>
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

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Request</span>
          <textarea
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            rows={4}
            className="resize-none rounded-md border border-foreground/10 bg-background px-3 py-2 text-base outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-muted-foreground">Initial questions</span>
          <textarea
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            rows={5}
            placeholder={"One question per line"}
            className="resize-none rounded-md border border-foreground/10 bg-background px-3 py-2 text-base outline-none focus:border-foreground/30"
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

function ApplicationReviewDrawer({
  applicationId,
  onClose,
}: {
  applicationId: Id<"applicationIntakes"> | null;
  onClose: () => void;
}) {
  const detail = useCachedQuery(
    "applicationIntakes.get",
    api.applicationIntakes.get,
    applicationId ? { applicationIntakeId: applicationId } : "skip",
  ) as (ApplicationRow & {
    messages?: Array<{ _id: string; content: string; createdAt: number; role: string }>;
    contextProposals?: Array<{ _id: string; key: string; value: string; status: string }>;
    packets?: Array<{ _id: string; status: string; missingFieldIds: string[]; createdAt: number }>;
  }) | undefined;
  const preparePacket = useMutation(api.applicationIntakes.preparePacket);
  const markSubmitted = useMutation(api.applicationIntakes.markSubmitted);
  const [busy, setBusy] = useState<"packet" | "submit" | null>(null);

  async function runPacket() {
    if (!applicationId) return;
    setBusy("packet");
    try {
      await preparePacket({ applicationIntakeId: applicationId });
      toast.success("Application packet prepared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare packet");
    } finally {
      setBusy(null);
    }
  }

  async function submitPacket() {
    if (!applicationId) return;
    setBusy("submit");
    try {
      await markSubmitted({ applicationIntakeId: applicationId });
      toast.success("Application marked submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to mark submitted");
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
      title={detail?.title ?? "Application"}
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Close
          </PillButton>
          {detail?.status === "broker_ready" ? (
            <PillButton type="button" disabled={busy !== null} onClick={submitPacket}>
              Mark submitted
            </PillButton>
          ) : (
            <PillButton type="button" disabled={!detail || busy !== null} onClick={runPacket}>
              Prepare packet
            </PillButton>
          )}
        </>
      }
    >
      {!detail ? (
        <OperationalSkeletonList rows={5} showTrailing={false} />
      ) : (
        <div className="flex flex-col gap-4">
          <OperationalPanel>
            <OperationalPanelHeader
              title="Status"
              action={<Badge variant={statusVariant(detail.status)}>{STATUS_LABELS[detail.status]}</Badge>}
              description={`${detail.clientName ?? "Client"} · ${formatTime(detail.updatedAt)}`}
            />
          </OperationalPanel>

          <OperationalPanel>
            <OperationalPanelHeader title="Missing information" />
            {detail.missingQuestions.length === 0 ? (
              <OperationalItem>
                <p className="text-base text-muted-foreground">No active missing questions.</p>
              </OperationalItem>
            ) : (
              detail.missingQuestions.map((question) => (
                <OperationalItem key={question.fieldId}>
                  <p className="text-base font-medium text-foreground">{question.label}</p>
                  <p className="mt-1 text-base text-muted-foreground">{question.prompt}</p>
                </OperationalItem>
              ))
            )}
          </OperationalPanel>

          <OperationalPanel>
            <OperationalPanelHeader title="Answers" />
            {detail.normalizedAnswers.length === 0 ? (
              <OperationalItem>
                <p className="text-base text-muted-foreground">No answers recorded yet.</p>
              </OperationalItem>
            ) : (
              detail.normalizedAnswers.map((answer) => (
                <OperationalItem key={answer.fieldId}>
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
              ))
            )}
          </OperationalPanel>
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
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"applicationIntakes"> | null>(null);
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("all");

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
        ? { status: status === "all" ? undefined : status }
        : "skip"
      : clientOrgId
        ? { orgId: clientOrgId as Id<"organizations"> }
        : "skip",
  ) as ApplicationRow[] | undefined;

  const filteredRows = useMemo(() => {
    const source = rows ?? [];
    if (mode === "client" && status !== "all") {
      return source.filter((row) => row.status === status);
    }
    return source;
  }, [mode, rows, status]);

  const readyCount = (rows ?? []).filter((row) => row.status === "broker_ready").length;
  const reviewCount = (rows ?? []).filter((row) => row.status === "needs_broker_review").length;
  const clientRows = useMemo(() => clients ?? [], [clients]);
  const rightPanel = useMemo(() => {
    if (createOpen) {
      return (
        <ApplicationCreateDrawer
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode={mode}
          fixedClientOrgId={clientOrgId}
          clients={clientRows}
        />
      );
    }
    if (selectedId) {
      return <ApplicationReviewDrawer applicationId={selectedId} onClose={() => setSelectedId(null)} />;
    }
    return null;
  }, [clientOrgId, clientRows, createOpen, mode, selectedId]);

  useEffect(() => {
    onRightPanelChange?.(rightPanel);
  }, [onRightPanelChange, rightPanel]);

  useEffect(() => {
    return () => onRightPanelChange?.(null);
  }, [onRightPanelChange]);

  const canStartApplication = mode === "client" || Boolean(currentOrg?.isBroker);
  const headerActions = useMemo(() => {
    if (!canStartApplication) return null;
    return (
      <PillButton size="compact" variant="primary" onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Start application
      </PillButton>
    );
  }, [canStartApplication]);

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
        <Tabs value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <TabsList variant="pill" className="scrollbar-hide max-w-full overflow-x-auto py-1">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {tab.value === "all" ? (
                  <span className="text-muted-foreground/60">
                    {(rows ?? []).length}
                  </span>
                ) : tab.value === "broker_ready" ? (
                  <span className="text-muted-foreground/60">{readyCount}</span>
                ) : tab.value === "needs_broker_review" ? (
                  <span className="text-muted-foreground/60">{reviewCount}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {rows === undefined ? (
          <OperationalSkeletonList rows={7} />
        ) : filteredRows.length === 0 ? (
          <EmptyStateCard
            icon={<FileText className="h-7 w-7" />}
            title="No applications"
            description="Start an intake from a broker request, client email, chat, or MCP workflow."
          />
        ) : (
          <>
            <OperationalPanel data-applications-mobile-list className="block sm:hidden">
              {filteredRows.map((row) => (
                <button
                  key={row._id}
                  type="button"
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
                    <span className="min-w-0 truncate">{row.clientName ?? "Client"}</span>
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
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Answers</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={row._id} className="cursor-pointer" onClick={() => setSelectedId(row._id)}>
                        <TableCell>
                          <div className="min-w-48">
                            <p className="font-medium text-foreground">{row.title}</p>
                            <p className="text-base text-muted-foreground">
                              {applicationSubtitle(row)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{row.clientName ?? "Client"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.normalizedAnswers.length} / {row.normalizedAnswers.length + row.missingQuestions.length}
                        </TableCell>
                        <TableCell>{formatTime(row.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          {row.status === "broker_ready" ? (
                            <PackageCheck className="ml-auto h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileCheck2 className="ml-auto h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
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
