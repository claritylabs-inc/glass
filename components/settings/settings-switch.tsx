"use client";

import { cn } from "@/lib/utils";

const LOGO_ICON_BLUE = "#A0D2FA";

export function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onCheckedChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10",
        !checked && "bg-foreground/15",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      style={checked ? { backgroundColor: LOGO_ICON_BLUE } : undefined}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-4.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
