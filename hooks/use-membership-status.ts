"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Returns the current user's org membership status.
 * "active"  — full access
 * "pending" — waiting for admin approval
 * null      — no membership / unauthenticated / still loading
 */
export function useMembershipStatus(): "active" | "pending" | null {
  const orgData = useQuery(api.orgs.viewerOrg);
  if (orgData === undefined) return null; // loading
  if (!orgData) return null; // no org
  const status = orgData.membership.status;
  if (status === "active" || status === "pending") return status;
  return null;
}
