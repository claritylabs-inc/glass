"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PolicyListItem } from "@/components/policy-list-item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DocType = "policy" | "quote";

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
  const [docType, setDocType] = useState<DocType>("policy");
  const vendorOrg = useQuery(api.orgs.getById, {
    orgId: vendorOrgId as Id<"organizations">,
  });
  const policies = useQuery(api.policies.listForOrg, {
    orgId: vendorOrgId as Id<"organizations">,
    documentType: docType,
  });

  const rows = policies ?? [];
  const vendorName =
    (vendorOrg as { name?: string } | null | undefined)?.name?.trim() ||
    "Vendor";

  return (
    <AppShell
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted-foreground/80">{vendorName}</span>
          <span className="text-body-sm text-muted-foreground/30">/</span>
          <span className="truncate">Policies</span>
        </span>
      }
    >
      <div className="space-y-4">
        <Tabs value={docType} onValueChange={(value) => setDocType(value as DocType)}>
          <TabsList variant="pill">
            <TabsTrigger value="policy">Policies</TabsTrigger>
            <TabsTrigger value="quote">Quotes</TabsTrigger>
          </TabsList>
        </Tabs>

        {policies === undefined ? (
          <VendorPoliciesLoadingSkeleton />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-foreground/6 bg-card px-5 py-6">
            <p className="text-body-sm font-medium text-foreground">
              No {docType === "quote" ? "quotes" : "policies"} yet
            </p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              Uploaded vendor insurance records will appear here when available.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-foreground/6 bg-card">
            {rows.map((policy) => (
              <PolicyListItem
                key={policy._id}
                carrier={policy.carrier}
                administrator={policy.mga}
                policyNumber={policy.policyNumber}
                effectiveDate={policy.effectiveDate}
                expirationDate={policy.expirationDate}
                pipelineStatus={policy.pipelineStatus}
                uploadedBySide={policy.uploadedBySide}
                onClick={() =>
                  router.push(
                    `/connect/vendors/${vendorOrgId}/policies/${policy._id}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
