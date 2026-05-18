"use client";

import { Combine, FileStack } from "lucide-react";
import type { ReactNode } from "react";
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
    <div className={cn("space-y-2", className)}>
      <div className="text-label-sm font-medium text-muted-foreground">
        Import as
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-lg border border-foreground/6 bg-foreground/3 p-1"
        role="radiogroup"
        aria-label="Import files as"
      >
        <ModeButton
          selected={value === "combined"}
          disabled={disabled}
          onClick={() => onChange("combined")}
          label={`One ${singular}`}
          icon={<Combine className="h-3.5 w-3.5" />}
        />
        <ModeButton
          selected={value === "separate"}
          disabled={disabled}
          onClick={() => onChange("separate")}
          label={`Separate ${plural}`}
          icon={<FileStack className="h-3.5 w-3.5" />}
        />
      </div>
    </div>
  );
}

function ModeButton({
  selected,
  disabled,
  onClick,
  label,
  icon,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-label-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
