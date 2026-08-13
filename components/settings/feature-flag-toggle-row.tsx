"use client";

import type { FeatureFlag } from "@/convex/lib/featureFlags";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";

export function FeatureFlagToggleRow({
  flag,
  enabled,
  onChange,
  disabled,
  loading,
}: {
  flag: FeatureFlag;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-popover px-4 py-3">
      <div>
        <p className={`text-foreground ${typeStyle("body.medium")}`}>{flag.label}</p>
        <p className={`mt-0.5 text-muted-foreground/60 ${typeStyle("caption.default")}`}>
          {flag.description}
        </p>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <SettingsSwitch
          checked={enabled}
          onCheckedChange={() => onChange(!enabled)}
          label={flag.label}
          disabled={disabled || loading}
        />
      </div>
    </div>
  );
}
