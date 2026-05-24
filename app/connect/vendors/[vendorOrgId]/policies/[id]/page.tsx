"use client";

import { use, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PolicyDetailBody } from "@/app/policies/[id]/policy-detail-body";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export default function ConnectedVendorPolicyDetailPage({
  params,
}: {
  params: Promise<{ vendorOrgId: string; id: string }>;
}) {
  const { vendorOrgId, id } = use(params);
  const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const vendorOrg = useCachedQuery("orgs.getById.vendorPolicyDetail", api.orgs.getById, {
    orgId: vendorOrgId as Id<"organizations">,
  });
  const vendorName =
    (vendorOrg as { name?: string } | null | undefined)?.name?.trim() ||
    "Vendor";

  return (
    <AppShell
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted-foreground/80">{vendorName}</span>
          <span className="text-body-sm text-muted-foreground/30">/</span>
          <span className="truncate">{breadcrumb}</span>
        </span>
      }
      actions={actions}
      rightPanel={rightPanel}
    >
      <PolicyDetailBody
        id={id}
        onBreadcrumb={setBreadcrumb}
        onActions={setActions}
        onRightPanel={setRightPanel}
        afterDeleteHref={`/connect/vendors/${vendorOrgId}/policies`}
        readOnly
      />
    </AppShell>
  );
}
