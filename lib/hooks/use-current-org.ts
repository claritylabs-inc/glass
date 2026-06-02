// lib/hooks/use-current-org.ts
//
// Returns the currently-active org context for the authenticated user.
// Handles multi-org users (broker OR client) and broker-of-client access.

"use client";

import { api } from "@/convex/_generated/api";
import { useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { useIsStoppingOperatorImpersonation } from "@/lib/operator-impersonation-stop-state";

export type CurrentOrgContext = {
  orgId: Id<"organizations">;
  orgType: "broker" | "client";
  accessType: "member" | "broker_of_client" | "connected_client";
  role: "admin" | "member" | undefined;
  orgName: string;
  brokerOrgId: Id<"organizations"> | undefined;
  slug: string | undefined;
  whiteLabelingEnabled: boolean;
  brandingColor: string | undefined;
  agentDisplayName: string | undefined;
};

/**
 * Returns the active org context.
 *
 * If the URL contains ?org=<orgId>, that org is used (for broker-of-client navigation).
 * Otherwise, falls back to the first org membership.
 *
 * Returns `null` while loading, `undefined` if the user has no org.
 */
export function useCurrentOrg(): CurrentOrgContext | null | undefined {
  const searchParams = useSearchParams();
  const isStoppingOperatorImpersonation = useIsStoppingOperatorImpersonation();
  const orgIdFromUrl = searchParams.get("org") as Id<"organizations"> | null;
  const viewer = useCachedQuery("hooks.currentOrg.viewer", api.users.viewer, {});
  const operatorContext = useCachedQuery(
    "hooks.currentOrg.operator.current",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.current,
    viewer?.accountKind === "operator" ? {} : "skip",
  );

  const orgData = useCachedQuery(
    orgIdFromUrl ? "orgs.viewerOrg.byUrl" : "orgs.viewerOrg",
    api.orgs.viewerOrg,
    orgIdFromUrl ? { orgId: orgIdFromUrl } : {},
  );

  if (viewer === undefined) return null;
  if (viewer?.accountKind === "operator") {
    if (isStoppingOperatorImpersonation) return undefined;
    if (operatorContext === undefined) return null;
    if (!operatorContext?.activeImpersonation) return undefined;
  }

  if (orgData === undefined) return null; // loading

  if (!orgData) return undefined; // no org

  const org = orgData.org as {
    _id: Id<"organizations">;
    name: string;
    type?: string;
    brokerOrgId?: Id<"organizations">;
    slug?: string;
    whiteLabelingEnabled?: boolean;
    brandingColor?: string;
    agentDisplayName?: string;
  };

  const membership = orgData.membership as {
    role: "admin" | "member";
  };

  // Determine orgType
  const orgType: "broker" | "client" = (org.type as "broker" | "client") ?? "client";

  // accessType: if orgIdFromUrl is provided and the user is NOT a direct member,
  // this would have returned null from viewerOrg — so if we have data, accessType = "member"
  // for this hook. Cross-org broker-of-client access requires a separate utility if needed.
  const accessType: "member" | "broker_of_client" | "connected_client" = "member";

  return {
    orgId: org._id,
    orgType,
    accessType,
    role: membership.role,
    orgName: org.name,
    brokerOrgId: org.brokerOrgId,
    slug: org.slug,
    whiteLabelingEnabled: org.whiteLabelingEnabled !== false,
    brandingColor: org.brandingColor,
    agentDisplayName: org.agentDisplayName,
  };
}
