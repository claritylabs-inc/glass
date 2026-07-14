"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Ban, ClipboardList, FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";

type MailboxAttachment = {
  filename: string;
  contentType?: string;
  size?: number;
};

type MailboxReviewEmail = {
  emailRef?: string;
  mailbox?: string;
  accountEmail?: string;
  subject: string;
  from?: string;
  date?: string;
  attachments: MailboxAttachment[];
};

export type LiveMailboxEmail = {
  subject: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  text?: string;
  attachments: MailboxAttachment[];
};

export function formatAttachmentSize(size?: number) {
  if (typeof size !== "number") return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isMailboxPdfAttachment(attachment: MailboxAttachment) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return type.includes("pdf") || name.endsWith(".pdf");
}

export function isMailboxRequirementAttachment(attachment: MailboxAttachment) {
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

export function totalCreatedRequirements(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const imports = (result as { imports?: unknown }).imports;
  if (!Array.isArray(imports)) return 0;
  return imports.reduce((total, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const createdCount = (item as { createdCount?: unknown }).createdCount;
    return total + (typeof createdCount === "number" ? createdCount : 0);
  }, 0);
}

export function MailboxEmailReviewSidebar({
  email,
  orgId,
  threadId,
  onClose,
}: {
  email: MailboxReviewEmail;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  onClose: () => void;
}) {
  const currentOrg = useCurrentOrg();
  const readEmail = useAction(api.actions.connectedEmail.readEmail);
  const importPolicyAttachments = useAction(api.actions.connectedEmail.importPolicyAttachments);
  const importRequirementAttachments = useAction(api.actions.connectedEmail.importRequirementAttachments);
  const resolveReview = useMutation(api.connectedEmailAutomation.resolveReview);
  const [liveEmail, setLiveEmail] = useState<LiveMailboxEmail | null>(null);
  const [readError, setReadError] = useState<string | null>(
    email.emailRef ? null : "Email reference is unavailable.",
  );
  const [readAttempt, setReadAttempt] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const showConnectFeatures = isFeatureEnabled(currentOrg?.org, "connect_features");

  useEffect(() => {
    if (!email.emailRef) return;
    let cancelled = false;
    void readEmail({ orgId, emailRef: email.emailRef })
      .then((result) => {
        if (cancelled) return;
        const row = result as Omit<LiveMailboxEmail, "attachments"> & {
          attachments?: Array<{
            filename?: string;
            contentType?: string;
            size?: number;
          }>;
        };
        setLiveEmail({
          ...row,
          attachments: (row.attachments ?? []).map((attachment) => ({
            ...attachment,
            filename: attachment.filename?.trim() || "Attachment",
          })),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReadError(
          error instanceof Error ? error.message : "The live message could not be loaded.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [email.emailRef, orgId, readAttempt, readEmail]);

  async function completeReview(
    resolution: "not_relevant" | "policy_imported" | "requirements_imported",
  ) {
    if (!email.emailRef) throw new Error("Email reference is unavailable");
    const result = await resolveReview({
      threadId,
      emailRef: email.emailRef,
      resolution,
    });
    if (!result.resolved) throw new Error("Email review is no longer available");
    onClose();
  }

  async function handleNotRelevant() {
    setBusyKey("not-relevant");
    try {
      await completeReview("not_relevant");
      toast.success("Marked not relevant");
    } catch {
      toast.error("Failed to update email review");
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePolicyImport() {
    if (!email.emailRef || !liveEmail) return;
    const filenames = liveEmail.attachments
      .filter(isMailboxPdfAttachment)
      .map((attachment) => attachment.filename);
    setBusyKey("policy");
    try {
      const result = await importPolicyAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; files?: unknown[] };
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
        return;
      }
      if (result.status === "failed") {
        toast.error("Failed to import policy");
        return;
      }
      await completeReview("policy_imported");
      toast.success(
        result.status === "duplicate"
          ? "Policy already imported"
          : `Started policy import for ${result.files?.length ?? filenames.length} file${filenames.length === 1 ? "" : "s"}`,
      );
    } catch {
      toast.error("Failed to import policy");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRequirementImport(scope: "vendors" | "own_org") {
    if (!email.emailRef || !liveEmail) return;
    const filenames = liveEmail.attachments
      .filter(isMailboxRequirementAttachment)
      .map((attachment) => attachment.filename);
    setBusyKey(scope);
    try {
      const result = await importRequirementAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames: filenames.length > 0 ? filenames : undefined,
        includeEmailBody: true,
        sourceType: scope === "vendors" ? "vendor_requirements" : "other",
        scope,
      });
      const createdCount = totalCreatedRequirements(result);
      if ((result as { status?: string })?.status === "no_requirement_sources") {
        toast.error("No insurance requirements found");
        return;
      }
      await completeReview("requirements_imported");
      toast.success(
        createdCount > 0
          ? `Imported ${createdCount} insurance requirement${createdCount === 1 ? "" : "s"}`
          : "Insurance requirements imported",
      );
    } catch {
      toast.error("Failed to import insurance requirements");
    } finally {
      setBusyKey(null);
    }
  }

  const attachments = liveEmail?.attachments ?? [];
  const receivedAt = liveEmail?.date ?? email.date;
  const hasPdf = attachments.some(isMailboxPdfAttachment);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
          {liveEmail?.subject ?? email.subject}
        </h2>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close email review">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <OperationalLabelValueList>
          <OperationalLabelValueRow label="From" value={liveEmail?.from ?? email.from} />
          <OperationalLabelValueRow label="To" value={liveEmail?.to} />
          <OperationalLabelValueRow label="Cc" value={liveEmail?.cc} />
          <OperationalLabelValueRow
            label="Received"
            value={receivedAt ? formatDisplayDateTime(receivedAt, receivedAt) : undefined}
          />
          <OperationalLabelValueRow label="Mailbox" value={email.accountEmail} />
          <OperationalLabelValueRow
            label="Folder"
            value={email.mailbox?.toUpperCase() === "INBOX" ? undefined : email.mailbox}
          />
        </OperationalLabelValueList>

        {liveEmail ? (
          <>
            {attachments.length > 0 ? (
              <section>
                <h3 className="mb-2 text-label font-medium text-muted-foreground">Attachments</h3>
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((attachment, index) => {
                    const size = formatAttachmentSize(attachment.size);
                    return (
                      <span
                        key={`${attachment.filename}-${index}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/8 px-2 py-1 text-tag text-muted-foreground"
                      >
                        <Paperclip className="h-3 w-3" />
                        <span className="truncate">{attachment.filename}</span>
                        {size ? <span className="text-muted-foreground/50">{size}</span> : null}
                      </span>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section>
              <h3 className="mb-2 text-label font-medium text-muted-foreground">Message</h3>
              <p className="whitespace-pre-wrap text-base leading-6 text-foreground/80">
                {liveEmail.text?.trim() || "This email has no plain-text message body."}
              </p>
            </section>
          </>
        ) : readError ? (
          <OperationalPanel as="div" className="p-4">
            <p className="text-base font-medium text-foreground">Couldn’t open this email</p>
            <p className="mt-1 text-base text-muted-foreground">{readError}</p>
            {email.emailRef ? (
              <PillButton
                className="mt-3"
                size="compact"
                variant="secondary"
                onClick={() => {
                  setReadError(null);
                  setLiveEmail(null);
                  setReadAttempt((attempt) => attempt + 1);
                }}
              >
                Try again
              </PillButton>
            ) : null}
          </OperationalPanel>
        ) : (
          <div className="flex items-center gap-2 py-8 text-base text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading email
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-foreground/8 px-4 py-3">
        <PillButton
          size="compact"
          variant="ghost"
          disabled={busyKey !== null || !email.emailRef}
          onClick={() => void handleNotRelevant()}
        >
          {busyKey === "not-relevant" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Ban className="h-3.5 w-3.5" />
          )}
          Not relevant
        </PillButton>
        {liveEmail ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasPdf ? (
              <PillButton
                size="compact"
                variant="secondary"
                disabled={busyKey !== null}
                onClick={() => void handlePolicyImport()}
              >
                {busyKey === "policy" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                Import policy
              </PillButton>
            ) : null}
            {showConnectFeatures ? (
              <>
                <PillButton
                  size="compact"
                  variant="secondary"
                  disabled={busyKey !== null}
                  onClick={() => void handleRequirementImport("vendors")}
                >
                  {busyKey === "vendors" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ClipboardList className="h-3.5 w-3.5" />
                  )}
                  Import vendor requirements
                </PillButton>
                <PillButton
                  size="compact"
                  variant="secondary"
                  disabled={busyKey !== null}
                  onClick={() => void handleRequirementImport("own_org")}
                >
                  {busyKey === "own_org" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ClipboardList className="h-3.5 w-3.5" />
                  )}
                  Import internal requirements
                </PillButton>
              </>
            ) : (
              <PillButton
                size="compact"
                variant="secondary"
                disabled={busyKey !== null}
                onClick={() => void handleRequirementImport("own_org")}
              >
                {busyKey === "own_org" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ClipboardList className="h-3.5 w-3.5" />
                )}
                Import insurance requirements
              </PillButton>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
