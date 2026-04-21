"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Returns the viewer's current org with org type and access type from Subsystem 1.
 * Falls back to "client" org type for orgs that predate the dual-org migration.
 */
export function useCurrentOrg() {
  const result = useQuery(api.orgs.viewerOrg, {});

  if (!result) return null;

  const { org, membership } = result;

  return {
    orgId: org._id,
    org,
    orgType: (org as { type?: "broker" | "client" }).type ?? "client",
    role: membership.role,
    isBroker: (org as { type?: "broker" | "client" }).type === "broker",
  };
}
