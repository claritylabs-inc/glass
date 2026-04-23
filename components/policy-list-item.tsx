"use client";

import { Badge } from "@/components/ui/badge";

type UploadedBySide = "broker" | "client" | "email_scan" | undefined;

interface PolicyListItemProps {
  carrier: string;
  policyNumber: string;
  effectiveDate?: string;
  expirationDate?: string;
  pipelineStatus?: string;
  uploadedBySide?: UploadedBySide;
  onClick?: () => void;
}

function ProvenanceBadge({ side }: { side: UploadedBySide }) {
  if (side === "broker") {
    return (
      <Badge variant="secondary" className="text-xs">
        Broker provided
      </Badge>
    );
  }
  if (side === "email_scan") {
    return (
      <Badge variant="outline" className="text-xs">
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
  policyNumber,
  effectiveDate,
  expirationDate,
  pipelineStatus,
  uploadedBySide,
  onClick,
}: PolicyListItemProps) {
  const isProcessing = pipelineStatus === "running" || !pipelineStatus;
  const carrierClean = cleanField(carrier);
  const policyNumberClean = cleanField(policyNumber);
  const effectiveClean = cleanField(effectiveDate);
  const expirationClean = cleanField(expirationDate);

  const title = carrierClean ?? (isProcessing ? "New upload" : "Untitled policy");
  const hasDates = effectiveClean && expirationClean;

  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 cursor-pointer hover:bg-muted/40 transition-colors"
      onClick={onClick}
    >
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
          {isProcessing ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Processing
            </Badge>
          ) : null}
          <ProvenanceBadge side={uploadedBySide} />
        </div>
        {policyNumberClean ? (
          <p className="text-xs text-muted-foreground truncate">{policyNumberClean}</p>
        ) : null}
      </div>
      {hasDates ? (
        <span className="text-xs text-muted-foreground hidden sm:block shrink-0 ml-4">
          {effectiveClean} – {expirationClean}
        </span>
      ) : null}
    </div>
  );
}
