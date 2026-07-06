"use client";

import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import {
  betaFeatureFlagsForOrgType,
  getFeatureFlagOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
} from "@/convex/lib/featureFlags";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { useSyncStore } from "@claritylabs/cl-sync";

export function BetaFeaturesSection() {
  const orgData = useCachedViewerOrg();
  const store = useSyncStore();
  const setFeatureFlag = useMutation(api.orgs.setFeatureFlag);
  const org = orgData?.org;
  const flags = betaFeatureFlagsForOrgType(getFeatureFlagOrgType(org));

  async function updateFeatureFlag(flagId: FeatureFlagId, enabled: boolean) {
    if (!org) return;
    const previousFlags = org.featureFlags;
    const nextFlags = setFeatureFlagPatch(previousFlags, flagId, enabled);
    patchCachedViewerOrg(store, { featureFlags: nextFlags });
    try {
      await setFeatureFlag({ flagId, enabled });
    } catch {
      patchCachedViewerOrg(store, { featureFlags: previousFlags });
      toast.error("Failed to update beta features");
    }
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Beta Features" className="px-5 py-3.5" />
      <OperationalPanelBody className="space-y-3 px-5 py-5">
        {flags.map((flag) => (
          <FeatureFlagToggleRow
            key={flag.id}
            flag={flag}
            enabled={isFeatureEnabled(org, flag.id)}
            onChange={(enabled) => void updateFeatureFlag(flag.id, enabled)}
          />
        ))}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
