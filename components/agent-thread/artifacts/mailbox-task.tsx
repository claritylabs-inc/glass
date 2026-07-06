"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import dayjs from "dayjs";
import { ClipboardList, FileText, Loader2, Mail as MailIcon, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { scientistSurnameFor } from "../scientist-surnames";
import type { ToolArtifactData } from "../types";

export function normalizeMailboxTask(data: unknown): {
  status?: string;
  summary?: string;
  steps: string[];
  text?: string;
  toolCalls: string[];
  searches: Array<{
    accountEmail?: string;
    mailbox: string;
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    resultCount: number;
    errorCount: number;
    identified: Array<{
      subject: string;
      from?: string;
      date?: string;
      attachmentCount?: number;
    }>;
  }>;
  emails: Array<{
    emailRef?: string;
    mailbox?: string;
    accountEmail?: string;
    subject: string;
    from?: string;
    date?: string;
    reason?: string;
    attachments: Array<{
      filename: string;
      contentType?: string;
      size?: number;
      reason?: string;
    }>;
  }>;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { steps: [], toolCalls: [], searches: [], emails: [] };
  }
  const record = data as Record<string, unknown>;
  const plan =
    record.plan && typeof record.plan === "object" && !Array.isArray(record.plan)
      ? (record.plan as Record<string, unknown>)
      : undefined;
  const steps = Array.isArray(plan?.steps)
    ? plan.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : [];
  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls.filter((toolCall): toolCall is string => typeof toolCall === "string" && toolCall.trim().length > 0)
    : [];
  const searches = Array.isArray(record.searches)
    ? record.searches
        .filter((search): search is Record<string, unknown> => !!search && typeof search === "object" && !Array.isArray(search))
        .map((search) => ({
          accountEmail: typeof search.accountEmail === "string" ? search.accountEmail : undefined,
          mailbox: typeof search.mailbox === "string" ? search.mailbox : "INBOX",
          query: typeof search.query === "string" ? search.query : undefined,
          dateFrom: typeof search.dateFrom === "string" ? search.dateFrom : undefined,
          dateTo: typeof search.dateTo === "string" ? search.dateTo : undefined,
          resultCount: typeof search.resultCount === "number" ? search.resultCount : 0,
          errorCount: typeof search.errorCount === "number" ? search.errorCount : 0,
          identified: Array.isArray(search.identified)
            ? search.identified
                .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
                .map((item) => ({
                  subject: typeof item.subject === "string" ? item.subject : "(no subject)",
                  from: typeof item.from === "string" ? item.from : undefined,
                  date: typeof item.date === "string" ? item.date : undefined,
                  attachmentCount: typeof item.attachmentCount === "number" ? item.attachmentCount : undefined,
                }))
            : [],
        }))
    : [];
  const evidence =
    record.evidence && typeof record.evidence === "object" && !Array.isArray(record.evidence)
      ? (record.evidence as Record<string, unknown>)
      : undefined;
  const emails = Array.isArray(evidence?.emails)
    ? evidence.emails
        .filter((email): email is Record<string, unknown> => !!email && typeof email === "object" && !Array.isArray(email))
        .map((email) => ({
          emailRef: typeof email.emailRef === "string" ? email.emailRef : undefined,
          mailbox: typeof email.mailbox === "string" ? email.mailbox : undefined,
          accountEmail: typeof email.accountEmail === "string" ? email.accountEmail : undefined,
          subject: typeof email.subject === "string" ? email.subject : "(no subject)",
          from: typeof email.from === "string" ? email.from : undefined,
          date: typeof email.date === "string" ? email.date : undefined,
          reason: typeof email.reason === "string" ? email.reason : undefined,
          attachments: Array.isArray(email.attachments)
            ? email.attachments
                .filter((attachment): attachment is Record<string, unknown> => !!attachment && typeof attachment === "object" && !Array.isArray(attachment))
                .map((attachment) => ({
                  filename: typeof attachment.filename === "string" ? attachment.filename : "Attachment",
                  contentType: typeof attachment.contentType === "string" ? attachment.contentType : undefined,
                  size: typeof attachment.size === "number" ? attachment.size : undefined,
                  reason: typeof attachment.reason === "string" ? attachment.reason : undefined,
                }))
            : [],
        }))
    : [];
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    summary: typeof plan?.summary === "string" ? plan.summary : undefined,
    steps,
    text: typeof record.text === "string" ? record.text : undefined,
    toolCalls,
    searches,
    emails,
  };
}

function formatAttachmentSize(size?: number) {
  if (typeof size !== "number") return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type MailboxTaskEmail = ReturnType<typeof normalizeMailboxTask>["emails"][number];
export type NormalizedMailboxTask = ReturnType<typeof normalizeMailboxTask>;

export function mailboxTaskDisplayName(task: NormalizedMailboxTask) {
  const accountEmails = [
    ...task.searches.map((search) => search.accountEmail),
    ...task.emails.map((email) => email.accountEmail),
  ].filter((email): email is string => typeof email === "string" && email.trim().length > 0);
  const uniqueAccounts = Array.from(new Set(accountEmails));
  if (uniqueAccounts.length === 0) return "Mailbox search";
  if (uniqueAccounts.length === 1) return `Mailbox search - ${uniqueAccounts[0]}`;
  return `Mailbox search - ${uniqueAccounts[0]} + ${uniqueAccounts.length - 1}`;
}

function isMailboxPdfAttachment(attachment: MailboxTaskEmail["attachments"][number]) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return type.includes("pdf") || name.endsWith(".pdf");
}

function isMailboxRequirementAttachment(attachment: MailboxTaskEmail["attachments"][number]) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return (
    type.includes("pdf") ||
    type.includes("wordprocessingml") ||
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  );
}

function totalCreatedRequirements(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const imports = (result as { imports?: unknown }).imports;
  if (!Array.isArray(imports)) return 0;
  return imports.reduce((total, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const createdCount = (item as { createdCount?: unknown }).createdCount;
    return total + (typeof createdCount === "number" ? createdCount : 0);
  }, 0);
}

function MailboxSearchAudit({ searches }: { searches: ReturnType<typeof normalizeMailboxTask>["searches"] }) {
  if (searches.length === 0) return null;
  const totalMatches = searches.reduce((total, search) => total + search.resultCount, 0);
  const totalErrors = searches.reduce((total, search) => total + search.errorCount, 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
          Search audit
        </p>
        <span className="text-label text-muted-foreground/40">
          {searches.length} search{searches.length === 1 ? "" : "es"} · {totalMatches} match{totalMatches === 1 ? "" : "es"}{totalErrors ? ` · ${totalErrors} error${totalErrors === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {searches.map((search, index) => {
          const windowText = [search.dateFrom, search.dateTo].filter(Boolean).join(" to ");
          return (
            <div key={`${search.accountEmail ?? "account"}-${search.mailbox}-${search.query ?? "all"}-${index}`} className="rounded-md border border-foreground/8 bg-foreground/[0.035] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="flex flex-wrap items-center gap-1.5 text-label text-muted-foreground/55">
                <Badge variant="outline" className="h-5 border-foreground/8 px-1.5 font-medium text-muted-foreground/55">
                  {search.accountEmail ?? "Mailbox"}
                </Badge>
                <span>{search.mailbox}</span>
                {windowText ? <span>· {windowText}</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-label font-medium text-foreground/80">
                  {search.query ? `"${search.query}"` : "All recent mail"}
                </span>
                <span className="shrink-0 text-label text-muted-foreground/45">
                  {search.resultCount} match{search.resultCount === 1 ? "" : "es"}
                </span>
              </div>
              {search.identified.length > 0 ? (
                <div className="mt-1.5 space-y-1">
                  {search.identified.map((item, itemIndex) => (
                    <div key={`${item.subject}-${itemIndex}`} className="flex min-w-0 items-center gap-2 text-label text-muted-foreground/55">
                      <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/35" />
                      <span className="min-w-0 flex-1 truncate">{item.subject}</span>
                      {item.attachmentCount ? (
                        <span className="shrink-0 text-muted-foreground/35">{item.attachmentCount} att.</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MailboxTaskSummaryCard({
  artifact,
  orgId,
  threadId,
  displayName,
  mode = "summary",
  onOpen,
  isSelected = false,
  flat = false,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  displayName: string;
  mode?: "summary" | "detail";
  onOpen?: () => void;
  isSelected?: boolean;
  flat?: boolean;
}) {
  const importPolicyAttachments = useAction(api.actions.connectedEmail.importPolicyAttachments);
  const importRequirementAttachments = useAction(api.actions.connectedEmail.importRequirementAttachments);
  const saveAttachmentsToThread = useAction(api.actions.connectedEmail.saveAttachmentsToThread);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (artifact.type !== "mailbox_task") return null;
  const task = normalizeMailboxTask(artifact.data);
  if (!task.summary && task.steps.length === 0 && task.toolCalls.length === 0 && task.searches.length === 0) return null;
  const isRunning = task.status === "running";

  async function handlePolicyImport(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const filenames = email.attachments.filter(isMailboxPdfAttachment).map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No PDF attachments found");
      return;
    }
    const key = `policy-${index}`;
    setBusyKey(key);
    try {
      const result = await importPolicyAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; files?: unknown[] };
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
      } else {
        toast.success(`Started policy import for ${result.files?.length ?? filenames.length} file${filenames.length === 1 ? "" : "s"}`);
      }
    } catch {
      toast.error("Failed to import policy");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveToThread(email: MailboxTaskEmail, index: number) {
    if (!threadId || !email.emailRef) return;
    const filenames = email.attachments.map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No attachments found");
      return;
    }
    const key = `save-${index}`;
    setBusyKey(key);
    try {
      const result = await saveAttachmentsToThread({
        orgId,
        threadId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; attachments?: unknown[]; skippedDuplicateFilenames?: string[] };
      if (result.status === "no_saveable_attachments") {
        toast.error("No saveable attachments found");
      } else if (result.status === "duplicate_attachments") {
        toast.info("Those documents are already saved to this thread");
      } else {
        toast.success(`Saved ${result.attachments?.length ?? filenames.length} document${filenames.length === 1 ? "" : "s"} to this thread`);
      }
    } catch {
      toast.error("Failed to save documents to thread");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRequirementImport(
    email: MailboxTaskEmail,
    index: number,
    appliesTo: "vendors" | "own_org",
  ) {
    if (!email.emailRef) return;
    const filenames = email.attachments
      .filter(isMailboxRequirementAttachment)
      .map((attachment) => attachment.filename);
    const key = `${appliesTo}-${index}`;
    setBusyKey(key);
    try {
      const result = await importRequirementAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames: filenames.length > 0 ? filenames : undefined,
        includeEmailBody: true,
        sourceType: appliesTo === "vendors" ? "vendor_requirements" : "other",
        appliesTo,
      });
      const createdCount = totalCreatedRequirements(result);
      if ((result as { status?: string })?.status === "no_requirement_sources") {
        toast.error("No requirement source text found");
      } else {
        toast.success(
          createdCount > 0
            ? `Created ${createdCount} requirement${createdCount === 1 ? "" : "s"}`
            : "Requirement import finished",
        );
      }
    } catch {
      toast.error("Failed to create requirements");
    } finally {
      setBusyKey(null);
    }
  }

  const totalMatches = task.searches.reduce((total, search) => total + search.resultCount, 0);
  const meta = [
    task.searches.length > 0 ? `${task.searches.length} searches` : undefined,
    task.searches.length > 0 ? `${totalMatches} matches` : undefined,
    task.emails.length > 0 ? `${task.emails.length} emails` : undefined,
  ].filter(Boolean).join(" · ");

  if (mode === "summary") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border bg-foreground/[0.025] px-2.5 py-1.5 text-tag font-medium text-muted-foreground/55 transition-colors ${
          isSelected ? "border-foreground/18 bg-foreground/[0.04]" : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.04]"
        }`}
      >
        {isRunning ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary-light/70" /> : <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/45" />}
        <span className="truncate">{displayName}</span>
      </button>
    );
  }

  return (
    <div className={flat ? "w-full" : "w-full overflow-hidden rounded-md border border-foreground/8 bg-card"}>
      <div className={flat ? "hidden" : "flex w-full items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2.5 text-left"}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailIcon className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-medium text-foreground/85">
              {displayName}
            </span>
            {meta ? (
              <span className="block truncate text-label text-muted-foreground/40">
                {meta}
              </span>
            ) : null}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="h-5 border-foreground/10 px-1.5 font-medium text-muted-foreground/55">
            {isRunning ? "Running" : "Background agent"}
          </Badge>
        </span>
      </div>
      <div className={flat ? "space-y-4" : "space-y-3 px-3 py-3"}>
        {task.summary ? (
          <p className="text-label leading-5 text-muted-foreground/75">
            {task.summary}
          </p>
        ) : null}
        {task.steps.length > 0 ? (
          <div>
            <p className="mb-1.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
              Plan
            </p>
            <ol className="space-y-1.5">
              {task.steps.map((step, index) => (
                <li key={`${step}-${index}`} className="flex gap-2 text-label leading-5 text-muted-foreground/70">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/8 text-label text-muted-foreground/50">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {task.toolCalls.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {task.toolCalls.map((toolCall, index) => (
              <Badge key={`${toolCall}-${index}`} variant="outline" className="h-5 border-foreground/8 px-1.5 font-medium text-muted-foreground/55">
                {scientistSurnameFor(`mailbox-tool:${toolCall}`, index)}
              </Badge>
            ))}
          </div>
        ) : null}
        <MailboxSearchAudit searches={task.searches} />
        {task.emails.length > 0 ? (
          <div>
            <p className="mb-1.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
              Email context
            </p>
            <div className="space-y-2">
              {task.emails.map((email, index) => (
                <div key={`${email.emailRef ?? email.subject}-${index}`} className="rounded-md border border-foreground/6 bg-background px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/85">
                      {email.subject}
                    </span>
                    {email.accountEmail ? (
                      <Badge variant="outline" className="h-5 border-foreground/8 px-1.5 font-medium text-muted-foreground/50">
                        {email.accountEmail}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-label text-muted-foreground/45">
                    {[email.from, email.mailbox, email.date ? dayjs(email.date).format("MMM D, YYYY h:mm A") : undefined].filter(Boolean).join(" · ")}
                  </p>
                  {email.reason ? (
                    <p className="mt-1 text-label leading-4 text-muted-foreground/65">
                      {email.reason}
                    </p>
                  ) : null}
                  {email.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {email.attachments.map((attachment, attachmentIndex) => {
                        const size = formatAttachmentSize(attachment.size);
                        return (
                          <span
                            key={`${attachment.filename}-${attachmentIndex}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.02] px-2 py-1 text-tag text-muted-foreground/65"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{attachment.filename}</span>
                            {size ? <span className="text-muted-foreground/35">{size}</span> : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                  {email.emailRef ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-foreground/6 pt-2">
                      {threadId && email.attachments.length > 0 ? (
                        <PillButton
                          size="compact"
                          variant="iconLabel"
                          label="Save to thread"
                          disabled={busyKey !== null}
                          onClick={() => void handleSaveToThread(email, index)}
                        >
                          {busyKey === `save-${index}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Paperclip className="h-3 w-3" />
                          )}
                        </PillButton>
                      ) : null}
                      {email.attachments.some(isMailboxPdfAttachment) ? (
                        <PillButton
                          size="compact"
                          variant="iconLabel"
                          label="Import policy"
                          disabled={busyKey !== null}
                          onClick={() => void handlePolicyImport(email, index)}
                        >
                          {busyKey === `policy-${index}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                        </PillButton>
                      ) : null}
                      <PillButton
                        size="compact"
                        variant="iconLabel"
                        label="Create vendor requirements"
                        disabled={busyKey !== null}
                        onClick={() => void handleRequirementImport(email, index, "vendors")}
                      >
                        {busyKey === `vendors-${index}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ClipboardList className="h-3 w-3" />
                        )}
                      </PillButton>
                      <PillButton
                        size="compact"
                        variant="iconLabel"
                        label="Create internal requirements"
                        disabled={busyKey !== null}
                        onClick={() => void handleRequirementImport(email, index, "own_org")}
                      >
                        {busyKey === `own_org-${index}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ClipboardList className="h-3 w-3" />
                        )}
                      </PillButton>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MailboxTaskSidebar({
  artifact,
  orgId,
  threadId,
  onClose,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  onClose: () => void;
}) {
  const task = normalizeMailboxTask(artifact.data);
  const isRunning = task.status === "running";
  const displayName = mailboxTaskDisplayName(task);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">{displayName}</h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 font-medium text-muted-foreground/55">
            {isRunning ? "Running" : "Background agent"}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close mailbox search">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MailboxTaskSummaryCard
          artifact={artifact}
          orgId={orgId}
          threadId={threadId}
          displayName={displayName}
          mode="detail"
          flat
        />
      </div>
    </aside>
  );
}
