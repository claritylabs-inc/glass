"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type Props = {
  source: string;
  override?: {
    connectorKey: string;
    syncedValue: unknown;
    syncedAt: number;
    overriddenAt: number;
  } | null;
  onRevert: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  passport: "From passport",
  integration: "From integration",
  document: "From document",
};

export function PrefillChip({ source, override, onRevert }: Props) {
  if (override) {
    const connectorName = override.connectorKey.split(":")[0];
    const syncedDisplay =
      typeof override.syncedValue === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            override.syncedValue,
          )
        : String(override.syncedValue);
    return (
      <div className="flex items-center gap-1">
        <Badge
          variant="outline"
          className="border-amber-400 text-amber-700 bg-amber-50 text-xs"
        >
          Overridden from {connectorName} · was {syncedDisplay}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onRevert}
          title="Use synced value again"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  const label = SOURCE_LABELS[source];
  if (!label || source === "manual") return null;

  return (
    <Badge variant="outline" className="border-green-400 text-green-700 bg-green-50 text-xs">
      {label}
    </Badge>
  );
}
