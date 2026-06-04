"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type PolicyUploadMode = "combined" | "separate";

interface PolicyUploadModeToggleProps {
  value: PolicyUploadMode;
  onChange: (value: PolicyUploadMode) => void;
  docType: "policy" | "quote";
  disabled?: boolean;
  className?: string;
}

export function PolicyUploadModeToggle({
  value,
  onChange,
  docType,
  disabled = false,
  className,
}: PolicyUploadModeToggleProps) {
  const singular = docType === "quote" ? "quote" : "policy";
  const plural = docType === "quote" ? "quotes" : "policies";

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="text-label font-medium text-muted-foreground">
        Import as
      </div>
      <Tabs
        value={value}
        onValueChange={(next) => {
          if (!disabled) onChange(next as PolicyUploadMode);
        }}
        className={cn("shrink-0", disabled && "pointer-events-none opacity-50")}
      >
        <TabsList variant="pill" aria-label="Import files as">
          <TabsTrigger value="combined" disabled={disabled}>
            One {singular}
          </TabsTrigger>
          <TabsTrigger value="separate" disabled={disabled}>
            Separate {plural}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
