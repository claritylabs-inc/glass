"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

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

const CERTIFICATE_ROW_GRID_CLASS =
  "grid min-w-0 gap-3 @xl/certificates-panel:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] @xl/certificates-panel:items-center";
const CERTIFICATE_ROW_ACTIONS_CLASS =
  "flex min-w-0 flex-wrap items-center gap-2 @xl/certificates-panel:justify-end @xl/certificates-panel:justify-self-end";

function jobBadge(status: string) {
  if (status === "failed" || status === "blocked_missing_contact") return "destructive" as const;
  if (status === "review_required") return "secondary" as const;
  if (status === "sent") return "default" as const;
  return "outline" as const;
}

function PolicyLink({ policyId, policy }: { policyId: Id<"policies">; policy?: CertificatePolicyRecord | null }) {
  return (
    <Link
      href={`/policies/${policyId}?tab=certificates`}
      className="block max-w-full truncate text-base font-medium text-foreground hover:underline"
    >
      {certificatePolicyLabel(policy)}
    </Link>
  );
}

function ReviewJobRow({ job }: { job: CertificateWorkflowJob }) {
  return (
    <OperationalItem>
      <div className={CERTIFICATE_ROW_GRID_CLASS}>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            {job.holder?.displayName ?? job.recipientName ?? "Certificate holder"}
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            {job.reason ?? job.lastError ?? "Certificate review queued"}
          </p>
        </div>
        <div className="min-w-0">
          <PolicyLink policyId={job.policyId} policy={job.policy} />
          <p className="mt-1 text-base text-muted-foreground">
            {job.kind.replace(/_/g, " ")} · {formatCertificateTime(job.updatedAt)}
          </p>
        </div>
        <div className={CERTIFICATE_ROW_ACTIONS_CLASS}>
          <Badge variant={jobBadge(job.status)} className="text-label capitalize">
            {job.status.replace(/_/g, " ")}
          </Badge>
          <Link
            href={`/policies/${job.policyId}?tab=certificates`}
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-foreground/8 bg-transparent px-3 text-label font-medium leading-none text-muted-foreground transition-colors hover:border-foreground/14 hover:bg-foreground/[0.03] hover:text-foreground"
          >
            Review
          </Link>
        </div>
      </div>
    </OperationalItem>
  );
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
