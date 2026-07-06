"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import {
  CertificateDetailPanel,
  CertificatePolicyGroupCard,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
  certificatePolicyLabel,
  formatCertificateTime,
  groupCertificatesByPolicy,
  type CertificateHolderRecord,
  type CertificatePolicyRecord,
  type CertificateVersionRecord,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { Badge } from "@/components/ui/badge";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { usePageContext } from "@/hooks/use-page-context";

type CertificateWorkspaceTab = "active" | "review";

type CertificateWorkflowJob = {
  _id: Id<"certificateWorkflowJobs">;
  certificateId: Id<"policyCertificates">;
  certificateVersionId?: Id<"certificateVersions">;
  holderId: Id<"certificateHolders">;
  policyId: Id<"policies">;
  policyVersionId?: Id<"policyVersions">;
  kind: string;
  status: string;
  reason?: string;
  recipientName?: string;
  recipientEmail?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  holder?: CertificateHolderRecord | null;
  policy?: CertificatePolicyRecord | null;
  certificateVersion?: CertificateVersionRecord | null;
};

const TABS: Array<{ value: CertificateWorkspaceTab; label: string }> = [
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
];

function jobBadge(status: string) {
  if (status === "failed" || status === "blocked_missing_contact") return "destructive" as const;
  if (status === "review_required") return "secondary" as const;
  if (status === "sent") return "default" as const;
  return "outline" as const;
}

function ReviewJobRow({ job }: { job: CertificateWorkflowJob }) {
  return (
    <OperationalItem>
      <div className="flex min-w-0 flex-col gap-3 @xl/certificates-panel:flex-row @xl/certificates-panel:items-start @xl/certificates-panel:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 max-w-full truncate text-base font-medium text-foreground">
              {job.holder?.displayName ?? job.recipientName ?? "Certificate holder"}
            </p>
            <Badge variant={jobBadge(job.status)} className="capitalize">
              {job.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="mt-1 text-base leading-5 text-muted-foreground">
            {job.reason ?? job.lastError ?? "Certificate review queued"}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted-foreground/70">
            <Link
              href={`/policies/${job.policyId}?tab=certificates`}
              className="min-w-0 max-w-full truncate font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              {certificatePolicyLabel(job.policy)}
            </Link>
            <span className="text-muted-foreground/35" aria-hidden="true">
              ·
            </span>
            <span className="capitalize">{job.kind.replace(/_/g, " ")}</span>
            <span className="text-muted-foreground/35" aria-hidden="true">
              ·
            </span>
            <span>{formatCertificateTime(job.updatedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center @xl/certificates-panel:justify-end">
          <PillButton
            href={`/policies/${job.policyId}?tab=certificates`}
            variant="secondary"
            size="compact"
          >
            Review
          </PillButton>
        </div>
      </div>
    </OperationalItem>
  );
}

function CertificatesPageContext({
  activeCount,
  reviewCount,
}: {
  activeCount: number;
  reviewCount: number;
}) {
  const { setPageContext } = usePageContext();

  useEffect(() => {
    setPageContext({
      pageType: "certificates",
      summary: `${activeCount} active certificate${activeCount === 1 ? "" : "s"} · ${reviewCount} review job${reviewCount === 1 ? "" : "s"}`,
    });

    return () => setPageContext(null);
  }, [activeCount, reviewCount, setPageContext]);

  return null;
}

export default function CertificatesPage() {
  const [tab, setTab] = useState<CertificateWorkspaceTab>("active");
  const [selectedCertificateId, setSelectedCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const viewerOrg = useCachedViewerOrg();
  const orgId = viewerOrg?.org?._id as Id<"organizations"> | undefined;
  const certificates = useCachedQuery(
    "certificateLifecycle.listForOrg",
    api.certificateLifecycle.listForOrg,
    orgId ? { orgId } : "skip",
  ) as PolicyCertificateRecord[] | undefined;
  const jobs = useCachedQuery(
    "certificateWorkflowJobs.listForOrg",
    api.certificateWorkflowJobs.listForOrg,
    orgId ? { orgId } : "skip",
  ) as CertificateWorkflowJob[] | undefined;

  const activeCertificates = useMemo(
    () =>
      (certificates ?? [])
        .filter((row) => row.status === "active")
        .sort((left, right) =>
          Number(right.lastIssuedAt ?? right.currentVersion?.createdAt ?? 0) -
          Number(left.lastIssuedAt ?? left.currentVersion?.createdAt ?? 0),
        ),
    [certificates],
  );
  const activeCertificateGroups = useMemo(
    () => groupCertificatesByPolicy(activeCertificates),
    [activeCertificates],
  );
  const reviewJobs = useMemo(
    () =>
      (jobs ?? [])
        .filter((job) => !["sent", "cancelled"].includes(job.status))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [jobs],
  );
  const selectedCertificate = useMemo(
    () =>
      (certificates ?? []).find((row) => row._id === selectedCertificateId) ??
      null,
    [certificates, selectedCertificateId],
  );

  const isLoading =
    viewerOrg === undefined || certificates === undefined || jobs === undefined;
  return (
    <AppShell
      rightPanel={selectedCertificate ? (
        <CertificateDetailPanel
          row={selectedCertificate}
          onClose={() => setSelectedCertificateId(null)}
        />
      ) : null}
    >
      <CertificatesPageContext
        activeCount={activeCertificates.length}
        reviewCount={reviewJobs.length}
      />
      <div className="space-y-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as CertificateWorkspaceTab)}
        >
          <TabsList variant="pill">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <OperationalSkeletonList rows={4} />
        ) : tab === "review" ? (
          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Certificate review jobs" />
            {reviewJobs.length > 0 ? (
              reviewJobs.map((job) => (
                <ReviewJobRow key={job._id} job={job} />
              ))
            ) : (
              <OperationalPanelBody className="px-4 py-10 text-center">
                <p className="text-base font-medium text-foreground">
                  No review jobs
                </p>
              </OperationalPanelBody>
            )}
          </OperationalPanel>
        ) : activeCertificateGroups.length > 0 ? (
          <div className="space-y-3">
            {activeCertificateGroups.map((group) => (
              <CertificatePolicyGroupCard
                key={group.key}
                group={group}
                selectedCertificateId={selectedCertificateId}
                onSelectCertificate={(row) => setSelectedCertificateId(row._id)}
              />
            ))}
          </div>
        ) : (
          <OperationalPanel as="div">
            <OperationalPanelBody className="px-4 py-10 text-center">
              <p className="text-base font-medium text-foreground">
                No active certificates
              </p>
              <p className="mt-1 text-base text-muted-foreground">
                Generate a COI from a policy to create the first holder-based certificate.
              </p>
            </OperationalPanelBody>
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
