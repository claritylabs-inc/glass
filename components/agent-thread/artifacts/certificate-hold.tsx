"use client";

import { AlertTriangle, Copy, FileLock2, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";

type CertificateHoldArtifact = {
  type?: string;
  data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function evidenceRows(value: unknown) {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item) => typeof item.excerpt === "string")
        .slice(0, 3)
    : [];
}

function labelForChange(value: string) {
  const labels: Record<string, string> = {
    additional_insured: "Additional insured",
    named_insured: "Named insured",
    waiver_of_subrogation: "Waiver of subrogation",
    primary_non_contributory: "Primary and non-contributory",
    loss_payee: "Loss payee",
    mortgagee: "Mortgagee",
    special_wording: "Special certificate wording",
    policy_change: "Policy change",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function emailDraft(value: unknown) {
  const record = asRecord(value);
  const subject = typeof record.subject === "string" ? record.subject : undefined;
  const body = typeof record.body === "string" ? record.body : undefined;
  if (!subject || !body) return undefined;
  return {
    subject,
    body,
    recipientEmail:
      typeof record.recipientEmail === "string" ? record.recipientEmail : undefined,
    recipientName:
      typeof record.recipientName === "string" ? record.recipientName : undefined,
  };
}

function mailtoHref(draft: {
  subject: string;
  body: string;
  recipientEmail?: string;
}) {
  return `mailto:${encodeURIComponent(draft.recipientEmail ?? "")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export function CertificateHoldArtifacts({
  artifacts,
}: {
  artifacts?: CertificateHoldArtifact[];
}) {
  const holds = (artifacts ?? []).filter(
    (artifact) => artifact.type === "certificate_hold",
  );
  if (holds.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {holds.map((artifact, index) => {
        const data = asRecord(artifact.data);
        const requiredChanges = asStringArray(data.requiredChanges);
        const evidence = evidenceRows(data.evidence);
        const message =
          typeof data.message === "string"
            ? data.message
            : "This certificate is on hold because it needs broker review before a COI can be issued.";
        const draft = emailDraft(data.emailDraft);

        return (
          <div
            key={`${String(data.holdId ?? "certificate-hold")}-${index}`}
            className="w-fit min-w-md max-w-xl overflow-hidden rounded-md border border-amber-500/20 bg-amber-500/[0.04]"
          >
            <div className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <FileLock2 className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium leading-5 text-foreground/90">
                      Certificate on hold
                    </p>
                    <Badge
                      variant="outline"
                      className="h-5 border-amber-500/25 px-1.5 capitalize text-amber-700"
                    >
                      broker review
                    </Badge>
                  </div>
                  <p className="mt-1 text-base leading-5 text-muted-foreground">
                    {message}
                  </p>
                </div>
              </div>

              {requiredChanges.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {requiredChanges.map((change) => (
                    <span
                      key={change}
                      className="rounded-full border border-foreground/10 bg-background px-2 py-0.5 text-tag text-muted-foreground"
                    >
                      {labelForChange(change)}
                    </span>
                  ))}
                </div>
              ) : null}

              {evidence.length > 0 ? (
                <details className="mt-3 rounded-md border border-foreground/8 bg-background/60 p-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-label font-medium text-muted-foreground">
                    <AlertTriangle className="size-3.5" />
                    Evidence checked
                  </summary>
                  <div className="mt-2 space-y-2">
                    {evidence.map((item, evidenceIndex) => (
                      <p
                        key={`${String(item.label ?? "evidence")}-${evidenceIndex}`}
                        className="text-label leading-5 text-muted-foreground/80"
                      >
                        {typeof item.label === "string" ? `${item.label}: ` : ""}
                        {String(item.excerpt)}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}

              {draft ? (
                <div className="mt-3 rounded-md border border-foreground/8 bg-background/70 p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-label font-medium text-foreground/85">
                        Broker email draft
                      </p>
                      <p className="mt-1 break-words text-base leading-5 text-foreground/80">
                        {draft.subject}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <PillButton
                        type="button"
                        size="compact"
                        variant="secondary"
                        onClick={() =>
                          navigator.clipboard?.writeText(
                            `Subject: ${draft.subject}\n\n${draft.body}`,
                          )
                        }
                      >
                        <Copy className="size-3.5" />
                        Copy
                      </PillButton>
                      <PillButton
                        href={mailtoHref(draft)}
                        size="compact"
                        variant="ghost"
                      >
                        <Mail className="size-3.5" />
                        Email
                      </PillButton>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-base leading-5 text-muted-foreground">
                    {draft.body}
                  </p>
                </div>
              ) : null}
            </div>

          </div>
        );
      })}
    </div>
  );
}
