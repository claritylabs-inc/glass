// components/integrations/connect-prompt.tsx
"use client";

import { MergeLinkButton } from "./merge-link-button";
import { Zap } from "lucide-react";

interface ConnectPromptProps {
  clientOrgId: string;
  category: "accounting" | "hris" | "payroll";
  metricLabel: string;
  originatingApplicationId?: string;
  integrationRequestId?: string;
  onLinked?: () => void;
}

const CATEGORY_COPY: Record<ConnectPromptProps["category"], string> = {
  accounting: "accounting software",
  hris: "HR system",
  payroll: "payroll provider",
};

export function ConnectPrompt({
  clientOrgId,
  category,
  metricLabel,
  originatingApplicationId,
  integrationRequestId,
  onLinked,
}: ConnectPromptProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
      <div className="mt-0.5 w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Zap className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-medium text-foreground">
          Auto-fill from {CATEGORY_COPY[category]}
        </p>
        <p className="text-label-sm text-muted-foreground/70 mt-0.5">
          Connect your {CATEGORY_COPY[category]} to populate{" "}
          <span className="font-medium">{metricLabel}</span> automatically.
        </p>
      </div>
      <MergeLinkButton
        clientOrgId={clientOrgId}
        category={category}
        originatingApplicationId={originatingApplicationId}
        integrationRequestId={integrationRequestId}
        label="Connect"
        variant="secondary"
        onLinked={onLinked}
      />
    </div>
  );
}
