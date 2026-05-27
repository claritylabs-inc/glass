"use client";

import { AlertTriangle, FileLock2 } from "lucide-react";
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
  return value.replace(/_/g, " ");
}

export function CertificateHoldArtifacts({
  artifacts,
  onOpenPolicyChange,
}: {
  artifacts?: CertificateHoldArtifact[];
  onOpenPolicyChange?: (caseId: string) => void;
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
        const policyChangeCaseId =
          typeof data.policyChangeCaseId === "string"
            ? data.policyChangeCaseId
            : undefined;

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
                    <p className="text-[13px] font-medium leading-5 text-foreground/90">
                      Certificate on hold
                    </p>
                    <Badge
                      variant="outline"
                      className="h-5 border-amber-500/25 px-1.5 text-[10px] capitalize text-amber-700"
                    >
                      broker review
                    </Badge>
                  </div>
                  <p className="mt-1 text-body-sm leading-5 text-muted-foreground">
                    {message}
                  </p>
                </div>
              </div>

              {requiredChanges.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {requiredChanges.map((change) => (
                    <span
                      key={change}
                      className="rounded-full border border-foreground/10 bg-background px-2 py-0.5 text-[11px] capitalize text-muted-foreground"
                    >
                      {labelForChange(change)}
                    </span>
                  ))}
                </div>
              ) : null}

              {evidence.length > 0 ? (
                <details className="mt-3 rounded-md border border-foreground/8 bg-background/60 p-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-label-sm font-medium text-muted-foreground">
                    <AlertTriangle className="size-3.5" />
                    Evidence checked
                  </summary>
                  <div className="mt-2 space-y-2">
                    {evidence.map((item, evidenceIndex) => (
                      <p
                        key={`${String(item.label ?? "evidence")}-${evidenceIndex}`}
                        className="text-[11px] leading-5 text-muted-foreground/80"
                      >
                        {typeof item.label === "string" ? `${item.label}: ` : ""}
                        {String(item.excerpt)}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>

            {policyChangeCaseId ? (
              <div className="flex justify-end border-t border-foreground/6 px-2 py-2">
                <PillButton
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => onOpenPolicyChange?.(policyChangeCaseId)}
                  className="text-muted-foreground/70"
                >
                  Review change request
                </PillButton>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
