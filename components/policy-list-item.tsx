"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type UploadedBySide =
  | "broker"
  | "client"
  | "email_scan"
  | "agent_email"
  | undefined;

interface PolicyListItemProps {
  carrier: string;
  administrator?: string;
  policyNumber: string;
  fileName?: string | null;
  effectiveDate?: string;
  expirationDate?: string;
  pipelineStatus?: string;
  extractionDataStage?: string;
  uploadedBySide?: UploadedBySide;
  href?: string;
  onClick?: () => void;
}

function ProvenanceBadge({ side }: { side: UploadedBySide }) {
  if (side === "broker") {
    return (
      <Badge variant="secondary" className="text-label">
        Broker provided
      </Badge>
    );
  }
  if (side === "email_scan") {
    return (
      <Badge variant="outline" className="text-label">
        Email scan
      </Badge>
    );
  }
  return null;
}

function cleanField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

export function PolicyListItem({
  carrier,
  administrator,
  policyNumber,
  fileName,
  effectiveDate,
  expirationDate,
  pipelineStatus,
  extractionDataStage,
  uploadedBySide,
  href,
  onClick,
}: PolicyListItemProps) {
  const isProvisional =
    extractionDataStage === "preview" && pipelineStatus !== "complete";
  const isProcessing =
    !isProvisional && (pipelineStatus === "running" || !pipelineStatus);
  const carrierClean = cleanField(carrier);
  const administratorClean = cleanField(administrator);
  const policyNumberClean = cleanField(policyNumber);
  const fileNameClean = cleanField(fileName ?? undefined);
  const effectiveClean = cleanField(effectiveDate);
  const expirationClean = cleanField(expirationDate);

  const title =
    administratorClean ??
    carrierClean ??
    (isProcessing ? (fileNameClean ?? "New upload") : "Untitled policy");
  const hasDates = effectiveClean && expirationClean;
  const rowClass =
    "flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 hover:bg-muted/40 transition-colors";
  const content = (
    <>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-foreground truncate">
            {title}
          </span>
          {isProcessing ? (
            <Badge
              variant="outline"
              className="text-label text-muted-foreground"
            >
              Extracting
            </Badge>
          ) : null}
          {isProvisional ? (
            <Badge
              variant="outline"
              className="text-label text-muted-foreground"
            >
              Enriching
            </Badge>
          ) : null}
          <ProvenanceBadge side={uploadedBySide} />
        </div>
        {policyNumberClean ? (
          <p className="text-label text-muted-foreground truncate">
            {policyNumberClean}
          </p>
        ) : null}
      </div>
      {hasDates ? (
        <span className="text-label text-muted-foreground hidden sm:block shrink-0 ml-4">
          {effectiveClean} – {expirationClean}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} prefetch className={rowClass}>
        {content}
      </Link>
    );
  }

  return (
    <div className={rowClass} onClick={onClick}>
      {content}
    </div>
  );
}
