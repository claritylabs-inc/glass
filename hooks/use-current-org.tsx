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

  const { org, membership, brokerOrg } = result;

  return {
    orgId: org._id,
    org,
    brokerOrg,
    orgType: (org as { type?: "broker" | "client" | "partner" }).type ?? "client",
    role: membership.role,
    isBroker: (org as { type?: "broker" | "client" | "partner" }).type === "broker",
    isPartner: (org as { type?: "broker" | "client" | "partner" }).type === "partner",
  };
}
