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

export function PolicyListItem({
  carrier,
  policyNumber,
  effectiveDate,
  expirationDate,
  pipelineStatus,
  uploadedBySide,
  onClick,
}: PolicyListItemProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 cursor-pointer hover:bg-muted/40 transition-colors"
      onClick={onClick}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{carrier}</span>
          {(pipelineStatus === "running" || !pipelineStatus) ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Processing
            </Badge>
          ) : null}
          <ProvenanceBadge side={uploadedBySide} />
        </div>
        <p className="text-xs text-muted-foreground">{policyNumber}</p>
      </div>
      {effectiveDate && expirationDate ? (
        <span className="text-xs text-muted-foreground hidden sm:block">
          {effectiveDate} – {expirationDate}
        </span>
      ) : null}
    </div>
  );
}
