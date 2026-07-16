"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PolicyListItem } from "@/components/policy-list-item";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

function VendorPoliciesLoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function ConnectedVendorPoliciesPage({
  params,
}: {
  params: Promise<{ vendorOrgId: string }>;
}) {
  const { vendorOrgId } = use(params);
  const router = useRouter();
  const vendorOrg = useCachedQuery("orgs.getById.vendorPolicies", api.orgs.getById, {
    orgId: vendorOrgId as Id<"organizations">,
  });
  const policies = useCachedQuery(
    "policies.listForOrg.vendorPolicies",
    api.policies.listForOrg,
    {
      orgId: vendorOrgId as Id<"organizations">,
      documentType: "policy",
    },
  );

  const rows = policies ?? [];
  const vendorName =
    (vendorOrg as { name?: string } | null | undefined)?.name?.trim() ||
    "Vendor";

  return (
    <AppShell
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted-foreground/80">{vendorName}</span>
          <span className="text-base text-muted-foreground/30">/</span>
          <span className="truncate">Policies</span>
        </span>
      }
    >
      <div className="space-y-4">
        {policies === undefined ? (
          <VendorPoliciesLoadingSkeleton />
        ) : rows.length === 0 ? (
          <OperationalPanel as="div">
            <OperationalPanelBody className="px-5 py-6">
              <p className="text-base font-medium text-foreground">
                No policies yet
              </p>
              <p className="mt-1 text-base text-muted-foreground">
                Uploaded vendor insurance records will appear here when available.
              </p>
            </OperationalPanelBody>
          </OperationalPanel>
        ) : (
          <OperationalPanel as="div">
            {rows.map((policy) => (
              <PolicyListItem
                key={policy._id}
                carrier={policy.carrier}
                generalAgent={policy.generalAgent?.agencyName ?? policy.mga}
                policyNumber={policy.policyNumber}
                fileName={policy.fileName}
                effectiveDate={policy.effectiveDate}
                expirationDate={policy.expirationDate}
                pipelineStatus={policy.pipelineStatus}
                extractionDataStage={policy.extractionDataStage}
                uploadedBySide={policy.uploadedBySide}
                onClick={() =>
                  router.push(
                    `/connect/vendors/${vendorOrgId}/policies/${policy._id}`,
                  )
                }
              />
            ))}
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
