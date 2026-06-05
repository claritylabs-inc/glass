"use client";

import dayjs from "dayjs";
import Link from "next/link";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import {
  OperationalDetailGroup,
  OperationalDetailRow,
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

type CertificateWorkspaceTab = "active" | "review" | "history";

type Holder = {
  _id: Id<"certificateHolders">;
  displayName: string;
  email?: string;
  phone?: string;
  address?: {
    formatted?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
};

type Policy = {
  _id: Id<"policies">;
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
};

type CertificateVersion = {
  _id: Id<"certificateVersions">;
  versionNumber: number;
  status: string;
  fileId?: Id<"_storage">;
  fileName?: string;
  fileSize?: number;
  authorityType?: string;
  certificationStatus?: string;
  issuedAt?: number;
  createdAt: number;
  url?: string | null;
};

type PolicyCertificateRow = {
  _id: Id<"policyCertificates">;
  policyId: Id<"policies">;
  holderId: Id<"certificateHolders">;
  status: string;
  lastIssuedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  holder?: Holder | null;
  policy?: Policy | null;
  currentVersion?: CertificateVersion | null;
  versions?: CertificateVersion[];
  url?: string | null;
};

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
  holder?: Holder | null;
  policy?: Policy | null;
  certificateVersion?: CertificateVersion | null;
};

const TABS: Array<{ value: CertificateWorkspaceTab; label: string }> = [
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "history", label: "History" },
];

const CERTIFICATE_PANEL_CONTAINER_CLASS = "@container/certificates-panel";
const CERTIFICATE_ROW_GRID_CLASS =
  "grid min-w-0 gap-3 @xl/certificates-panel:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] @xl/certificates-panel:items-center";
const CERTIFICATE_ROW_ACTIONS_CLASS =
  "flex min-w-0 flex-wrap items-center gap-2 @xl/certificates-panel:justify-end @xl/certificates-panel:justify-self-end";
const CERTIFICATE_ROW_CLICKABLE_CLASS =
  "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-inset";

function policyLabel(policy?: Policy | null) {
  return [
    policy?.policyNumber,
    policy?.carrier ?? policy?.security ?? policy?.mga,
  ].filter(Boolean).join(" · ") || "Policy";
}

function holderAddress(holder?: Holder | null) {
  const address = holder?.address;
  if (!address) return null;
  const cityLine = [
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return address.formatted ||
    [address.line1, address.line2, cityLine].filter(Boolean).join("\n") ||
    null;
}

function formatTime(value?: number) {
  return value ? dayjs(value).format("MMM D, YYYY h:mm A") : "Not issued";
}

function certificateBadge(row: PolicyCertificateRow) {
  const version = row.currentVersion;
  if (!version) return { label: "No issued version", variant: "outline" as const };
  if (version.status === "issued") {
    const isCertified = version.authorityType === "certified";
    return {
      label: isCertified ? "Certified" : "Non-binding",
      variant: isCertified ? "secondary" as const : "outline" as const,
    };
  }
  return { label: version.status.replace(/_/g, " "), variant: "outline" as const };
}

function versionBadge(version?: CertificateVersion | null) {
  if (!version) return { label: "No version", variant: "outline" as const };
  if (version.status === "issued") return { label: "Issued", variant: "secondary" as const };
  if (version.status === "void") return { label: "Void", variant: "destructive" as const };
  return {
    label: version.status.replace(/_/g, " "),
    variant: "outline" as const,
  };
}

function jobBadge(status: string) {
  if (status === "failed" || status === "blocked_missing_contact") return "destructive" as const;
  if (status === "review_required") return "secondary" as const;
  if (status === "sent") return "default" as const;
  return "outline" as const;
}

function sortedVersions(row: PolicyCertificateRow) {
  return [...(row.versions?.length ? row.versions : row.currentVersion ? [row.currentVersion] : [])]
    .sort((left, right) => right.versionNumber - left.versionNumber);
}

function latestVersionActivityAt(row: PolicyCertificateRow) {
  const latestVersion = sortedVersions(row)[0];
  return latestVersion?.issuedAt ?? latestVersion?.createdAt ?? row.lastIssuedAt ?? row.updatedAt ?? row.createdAt;
}

function openOnKeyboard(
  event: KeyboardEvent<HTMLDivElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function CertificatePdfItem({
  url,
  ariaLabel,
  children,
}: {
  url?: string | null;
  ariaLabel: string;
  children: ReactNode;
}) {
  const { openWithUrl } = usePdf();
  const canOpen = Boolean(url);
  const openCertificate = () => {
    if (url) openWithUrl(url);
  };

  return (
    <OperationalItem
      aria-disabled={canOpen ? undefined : true}
      aria-label={canOpen ? ariaLabel : undefined}
      className={canOpen ? CERTIFICATE_ROW_CLICKABLE_CLASS : undefined}
      onClick={canOpen ? openCertificate : undefined}
      onKeyDown={canOpen ? (event) => openOnKeyboard(event, openCertificate) : undefined}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      {children}
    </OperationalItem>
  );
}

function PolicyTitle({ policy }: { policy?: Policy | null }) {
  return (
    <p className="block max-w-full truncate text-base font-medium text-foreground">
      {policyLabel(policy)}
    </p>
  );
}

function PolicyLink({ policyId, policy }: { policyId: Id<"policies">; policy?: Policy | null }) {
  return (
    <Link
      href={`/policies/${policyId}?tab=certificates`}
      className="block max-w-full truncate text-base font-medium text-foreground hover:underline"
    >
      {policyLabel(policy)}
    </Link>
  );
}

function CertificateRow({ row }: { row: PolicyCertificateRow }) {
  const badge = certificateBadge(row);
  const version = row.currentVersion;
  return (
    <CertificatePdfItem
      url={row.url}
      ariaLabel={`Open certificate PDF for ${row.holder?.displayName ?? "certificate holder"}`}
    >
      <div className={CERTIFICATE_ROW_GRID_CLASS}>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            {row.holder?.displayName ?? "Certificate holder"}
          </p>
          <p className="mt-1 whitespace-pre-line text-base text-muted-foreground">
            {holderAddress(row.holder) ?? row.holder?.email ?? "No holder contact recorded"}
          </p>
        </div>
        <div className="min-w-0">
          <PolicyTitle policy={row.policy} />
          <p className="mt-1 text-base text-muted-foreground">
            Version {version?.versionNumber ?? "-"} · {formatTime(version?.issuedAt ?? row.lastIssuedAt)}
          </p>
        </div>
        <div className={CERTIFICATE_ROW_ACTIONS_CLASS}>
          <Badge variant={badge.variant} className="text-label capitalize">
            {badge.label}
          </Badge>
        </div>
      </div>
    </CertificatePdfItem>
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
            {job.kind.replace(/_/g, " ")} · {formatTime(job.updatedAt)}
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

function CertificateHistorySummaryRow({
  row,
  selected,
  onSelect,
}: {
  row: PolicyCertificateRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const versions = sortedVersions(row);
  const latestVersion = versions[0] ?? row.currentVersion;
  const badge = certificateBadge(row);
  const latestLabel = latestVersion
    ? `Latest v${latestVersion.versionNumber} · ${formatTime(latestVersion.issuedAt ?? latestVersion.createdAt)}`
    : "No versions recorded";
  return (
    <OperationalItem
      aria-label={`View certificate history for ${row.holder?.displayName ?? "certificate holder"}`}
      aria-pressed={selected}
      className={`${CERTIFICATE_ROW_CLICKABLE_CLASS} ${selected ? "bg-muted/40" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => openOnKeyboard(event, onSelect)}
      role="button"
      tabIndex={0}
    >
      <div className={CERTIFICATE_ROW_GRID_CLASS}>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            {row.holder?.displayName ?? "Certificate holder"}
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            {row.holder?.email ?? holderAddress(row.holder) ?? "No holder contact recorded"}
          </p>
        </div>
        <div className="min-w-0">
          <PolicyTitle policy={row.policy} />
          <p className="mt-1 text-base text-muted-foreground">
            {versions.length} {versions.length === 1 ? "version" : "versions"} · {latestLabel}
          </p>
        </div>
        <div className={CERTIFICATE_ROW_ACTIONS_CLASS}>
          <Badge variant={badge.variant} className="text-label capitalize">
            {badge.label}
          </Badge>
        </div>
      </div>
    </OperationalItem>
  );
}

function CertificateVersionRow({ version }: { version: CertificateVersion }) {
  const badge = versionBadge(version);
  return (
    <CertificatePdfItem
      url={version.url}
      ariaLabel={`Open certificate version ${version.versionNumber} PDF`}
    >
      <div className="grid min-w-0 gap-3 @md/certificates-panel:grid-cols-[minmax(0,1fr)_auto] @md/certificates-panel:items-center">
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            Version {version.versionNumber}
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            {formatTime(version.issuedAt ?? version.createdAt)}
          </p>
        </div>
        <div className={CERTIFICATE_ROW_ACTIONS_CLASS}>
          <Badge variant={badge.variant} className="text-label capitalize">
            {badge.label}
          </Badge>
        </div>
      </div>
    </CertificatePdfItem>
  );
}

function CertificateDetailPanel({
  row,
  onClose,
}: {
  row: PolicyCertificateRow | null;
  onClose: () => void;
}) {
  const versions = row ? sortedVersions(row) : [];
  const currentVersion = row?.currentVersion;
  const badge = row ? certificateBadge(row) : null;

  return (
    <SettingsDrawer
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Certificate"
    >
      {row ? (
        <div className="flex flex-col gap-5">
          <section className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {badge ? (
                <Badge variant={badge.variant} className="text-label capitalize">
                  {badge.label}
                </Badge>
              ) : null}
              {currentVersion ? (
                <Badge variant="outline" className="text-label">
                  Version {currentVersion.versionNumber}
                </Badge>
              ) : null}
            </div>
            <h2 className="truncate text-base font-medium text-foreground">
              {row.holder?.displayName ?? "Certificate holder"}
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {policyLabel(row.policy)}
            </p>
          </section>

          <OperationalDetailGroup title="Holder">
            <OperationalDetailRow label="Name" value={row.holder?.displayName} />
            <OperationalDetailRow label="Email" value={row.holder?.email} />
            <OperationalDetailRow label="Phone" value={row.holder?.phone} />
            <OperationalDetailRow label="Address" value={holderAddress(row.holder)} />
          </OperationalDetailGroup>

          <OperationalDetailGroup title="Policy">
            <OperationalDetailRow label="Policy no." value={row.policy?.policyNumber} />
            <OperationalDetailRow label="Carrier" value={row.policy?.carrier ?? row.policy?.security ?? row.policy?.mga} />
            <OperationalDetailRow label="Insured" value={row.policy?.insuredName} />
          </OperationalDetailGroup>

          <section>
            <h3 className="mb-2 text-label font-medium text-muted-foreground">
              Versions
            </h3>
            <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
              {versions.length > 0 ? (
                versions.map((version) => (
                  <CertificateVersionRow key={version._id} version={version} />
                ))
              ) : (
                <OperationalPanelBody className="px-4 py-6">
                  <p className="text-base text-muted-foreground">
                    No versions recorded.
                  </p>
                </OperationalPanelBody>
              )}
            </OperationalPanel>
          </section>
        </div>
      ) : null}
    </SettingsDrawer>
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
  ) as PolicyCertificateRow[] | undefined;
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
  const reviewJobs = useMemo(
    () =>
      (jobs ?? [])
        .filter((job) => !["sent", "cancelled"].includes(job.status))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [jobs],
  );
  const historyCertificates = useMemo(
    () =>
      (certificates ?? [])
        .filter((row) => sortedVersions(row).length > 0)
        .sort((left, right) =>
          Number(latestVersionActivityAt(right) ?? 0) -
          Number(latestVersionActivityAt(left) ?? 0),
        ),
    [certificates],
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
      rightPanel={
        <CertificateDetailPanel
          row={selectedCertificate}
          onClose={() => setSelectedCertificateId(null)}
        />
      }
    >
      <div className="space-y-4">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const nextTab = value as CertificateWorkspaceTab;
            setTab(nextTab);
            if (nextTab !== "history") setSelectedCertificateId(null);
          }}
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
        ) : tab === "history" ? (
          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Certificate history" />
            {historyCertificates.length > 0 ? (
              historyCertificates.map((row) => (
                <CertificateHistorySummaryRow
                  key={row._id}
                  row={row}
                  selected={row._id === selectedCertificateId}
                  onSelect={() => setSelectedCertificateId(row._id)}
                />
              ))
            ) : (
              <OperationalPanelBody className="px-4 py-10 text-center">
                <p className="text-base font-medium text-foreground">
                  No certificate history
                </p>
              </OperationalPanelBody>
            )}
          </OperationalPanel>
        ) : activeCertificates.length > 0 ? (
          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Active certificates" />
            {activeCertificates.map((row) => (
              <CertificateRow key={row._id} row={row} />
            ))}
          </OperationalPanel>
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
