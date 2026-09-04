"use client";

import { Loader2 } from "lucide-react";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

/**
 * One labelled switch in settings. `framed` draws its own card for standalone
 * lists; the default sits inside an OperationalPanel's divided body.
 */
export function SettingsToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  loading,
  framed,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  framed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        framed
          ? "rounded-lg border border-border bg-popover px-4 py-3"
          : "py-3.5",
      )}
    >
      <div className="min-w-0">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>{title}</p>
        <p
          className={`mt-0.5 max-w-md text-muted-foreground/60 ${typeStyle("caption.default")}`}
        >
          {description}
        </p>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <SettingsSwitch
          checked={checked}
          onCheckedChange={() => onCheckedChange(!checked)}
          label={title}
          disabled={disabled || loading}
        />
      </div>
    </div>
  );
}
