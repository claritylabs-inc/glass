"use client";

import type { FeatureFlag } from "@/convex/lib/featureFlags";
import { SettingsToggleRow } from "@/components/settings/settings-toggle-row";

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
    <SettingsToggleRow
      framed
      title={flag.label}
      description={flag.description}
      checked={enabled}
      onCheckedChange={onChange}
      disabled={disabled}
      loading={loading}
    />
  );
}
