"use client";

import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

/**
 * Returns the viewer's current org with org type and access type from Subsystem 1.
 * Falls back to "client" org type for orgs that predate the dual-org migration.
 */
export function useCurrentOrg() {
  const result = useCachedQuery("hooks.currentOrg.viewerOrg", api.orgs.viewerOrg, {});

  return useMemo(() => {
    if (!result) return null;

    const { org, membership, brokerOrg } = result;

    const orgType =
      (org as { type?: "broker" | "client" | "partner" }).type ?? "client";

    return {
      orgId: org._id,
      org,
      brokerOrg,
      orgType,
      role: membership.role,
      isBroker: orgType === "broker",
      isPartner: orgType === "partner",
    };
  }, [result]);
}
