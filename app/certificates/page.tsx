"use client";

import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import {
  CertificateDetailPanel,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
  certificateBadge,
  certificateHolderActionAddress,
  certificateHolderAddress,
  certificatePolicyLabel,
  formatCertificateTime,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedViewerOrg } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { usePageContext } from "@/hooks/use-page-context";
import { usePdf } from "@/components/pdf-context";

type CertificateWorkspaceTab = "active" | "review" | "archived";
type CertificatePolicyFilter = "all" | `policy:${string}`;
type CertificateTypeFilter = "all" | "holder" | "additional_insured";
type CertificateContactFilter = "all" | "has_email" | "missing_email";
type CertificateStatusFilter = "all" | `status:${string}`;

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
  { value: "archived", label: "Archived" },
];

function certificatePolicyFilterValue(row: PolicyCertificateRecord): CertificatePolicyFilter {
  return `policy:${String(row.policyId)}`;
}

function certificateTypeValue(row: PolicyCertificateRecord): CertificateTypeFilter {
  return row.currentVersion?.requestKind === "additional_insured"
    ? "additional_insured"
    : "holder";
}

function certificateTypeLabel(value: CertificateTypeFilter) {
  if (value === "all") return "All types";
  return value === "additional_insured" ? "Additional insured" : "Holder";
}

function certificateStatusValue(row: PolicyCertificateRecord): CertificateStatusFilter {
  if (row.status === "archived") return "status:archived";
  return row.currentVersion?.status
    ? `status:${row.currentVersion.status}`
    : "status:no_issued_version";
}

function certificateStatusLabel(value: CertificateStatusFilter) {
  if (value === "all") return "All statuses";
  if (value === "status:no_issued_version") return "No issued version";
  return value
    .slice("status:".length)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function certificateContactFilterLabel(value: CertificateContactFilter) {
  if (value === "all") return "All holders";
  return value === "has_email" ? "Has email" : "Missing email";
}

function certificateCarrier(row: PolicyCertificateRecord) {
  return row.policy?.carrier ?? row.policy?.security ?? row.policy?.mga;
}

function certificateHolderAddressSummary(row: PolicyCertificateRecord) {
  return certificateHolderAddress(row.holder)
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

function certificateContactSummary(row: PolicyCertificateRecord) {
  const primary =
    row.holder?.email ??
    row.holder?.phone ??
    row.holder?.contactName ??
    "No email";
  const secondary = [
    row.holder?.contactName && row.holder.contactName !== primary
      ? row.holder.contactName
      : undefined,
    row.holder?.phone && row.holder.phone !== primary ? row.holder.phone : undefined,
  ].filter(Boolean).join(" · ");
  return { primary, secondary };
}

function certificatePolicyFilterOptions(rows: PolicyCertificateRecord[]) {
  const byValue = new Map<CertificatePolicyFilter, string>();
  for (const row of rows) {
    byValue.set(certificatePolicyFilterValue(row), certificatePolicyLabel(row.policy));
  }
  return [
    { value: "all" as const, label: "All policies" },
    ...Array.from(byValue, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function certificateTypeFilterOptions(rows: PolicyCertificateRecord[]) {
  const present = new Set(rows.map(certificateTypeValue));
  const values: CertificateTypeFilter[] = ["holder", "additional_insured"];
  return [
    { value: "all" as const, label: certificateTypeLabel("all") },
    ...values
      .filter((value) => present.has(value))
      .map((value) => ({ value, label: certificateTypeLabel(value) })),
  ];
}

function certificateStatusFilterOptions(rows: PolicyCertificateRecord[]) {
  const present = Array.from(new Set(rows.map(certificateStatusValue)))
    .sort((left, right) => certificateStatusLabel(left).localeCompare(certificateStatusLabel(right)));
  return [
    { value: "all" as const, label: certificateStatusLabel("all") },
    ...present.map((value) => ({ value, label: certificateStatusLabel(value) })),
  ];
}

function filterCertificates({
  rows,
  policyFilter,
  typeFilter,
  contactFilter,
  statusFilter,
}: {
  rows: PolicyCertificateRecord[];
  policyFilter: CertificatePolicyFilter;
  typeFilter: CertificateTypeFilter;
  contactFilter: CertificateContactFilter;
  statusFilter: CertificateStatusFilter;
}) {
  return rows.filter((row) =>
    (policyFilter === "all" || certificatePolicyFilterValue(row) === policyFilter) &&
    (typeFilter === "all" || certificateTypeValue(row) === typeFilter) &&
    (contactFilter === "all" ||
      (contactFilter === "has_email" ? Boolean(row.holder?.email) : !row.holder?.email)) &&
    (statusFilter === "all" || certificateStatusValue(row) === statusFilter),
  );
}

function openTableRowOnKeyboard(
  event: KeyboardEvent<HTMLTableRowElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

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

function CertificatesFilterSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(next) => next && onValueChange(next)}>
        <SelectTrigger size="sm" className="w-full bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

function CertificatesTable({
  rows,
  selectedCertificateId,
  onSelectCertificate,
  onOpenPdf,
}: {
  rows: PolicyCertificateRecord[];
  selectedCertificateId?: Id<"policyCertificates"> | null;
  onSelectCertificate: (row: PolicyCertificateRecord) => void;
  onOpenPdf: (url: string) => void;
}) {
  return (
    <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
      <Table className="min-w-[1120px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[21%] px-4">Holder</TableHead>
            <TableHead className="w-[18%]">Contact</TableHead>
            <TableHead className="w-[22%]">Policy</TableHead>
            <TableHead className="w-[14%]">Type</TableHead>
            <TableHead className="w-[13%]">Issued</TableHead>
            <TableHead className="w-[7%]">Status</TableHead>
            <TableHead className="w-[5%] px-4 text-right">PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const badge = certificateBadge(row);
            const contact = certificateContactSummary(row);
            const address = certificateHolderAddressSummary(row);
            const currentVersion = row.currentVersion;
            const currentUrl = row.url ?? currentVersion?.url;
            const selected = row._id === selectedCertificateId;
            const issuedAt = row.lastIssuedAt ?? currentVersion?.issuedAt ?? currentVersion?.createdAt;
            const type = certificateTypeValue(row);
            const carrier = certificateCarrier(row);

            return (
              <TableRow
                key={row._id}
                aria-selected={selected}
                className="cursor-pointer"
                data-state={selected ? "selected" : undefined}
                onClick={() => onSelectCertificate(row)}
                onKeyDown={(event) =>
                  openTableRowOnKeyboard(event, () => onSelectCertificate(row))
                }
                tabIndex={0}
              >
                <TableCell className="max-w-64 px-4">
                  <p className="truncate font-medium text-foreground">
                    {row.holder?.displayName ?? "Certificate holder"}
                  </p>
                  {address ? (
                    <p className="truncate text-label text-muted-foreground">
                      {address}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-56">
                  <p className={row.holder?.email ? "truncate text-foreground" : "truncate text-muted-foreground"}>
                    {contact.primary}
                  </p>
                  {contact.secondary ? (
                    <p className="truncate text-label text-muted-foreground">
                      {contact.secondary}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-72">
                  <p className="truncate font-medium text-foreground">
                    {row.policy?.policyNumber ?? "Policy"}
                  </p>
                  {carrier || row.policy?.insuredName ? (
                    <p className="truncate text-label text-muted-foreground">
                      {[carrier, row.policy?.insuredName].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-48">
                  <p className="truncate text-foreground">
                    {certificateTypeLabel(type)}
                  </p>
                  {currentVersion?.additionalInsuredName ? (
                    <p className="truncate text-label text-muted-foreground">
                      {currentVersion.additionalInsuredName}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <p className="text-foreground">
                    {formatCertificateTime(issuedAt)}
                  </p>
                  {currentVersion ? (
                    <p className="text-label text-muted-foreground">
                      Version {currentVersion.versionNumber}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={badge.variant} className="capitalize">
                    {badge.label}
                  </Badge>
                </TableCell>
                <TableCell
                  className="px-4 text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {currentUrl ? (
                    <PillButton
                      type="button"
                      variant="secondary"
                      size="compact"
                      onClick={() => onOpenPdf(currentUrl)}
                    >
                      <FileText className="size-3.5" />
                      PDF
                    </PillButton>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function CertificateEmptyPanel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelBody className="px-4 py-10 text-center">
        <p className="text-base font-medium text-foreground">
          {title}
        </p>
        {description ? (
          <p className="mt-1 text-base text-muted-foreground">
            {description}
          </p>
        ) : null}
      </OperationalPanelBody>
    </OperationalPanel>
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
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const archiveCertificateMutation = useMutation(api.certificateLifecycle.archive);
  const unarchiveCertificateMutation = useMutation(api.certificateLifecycle.unarchive);
  const { openWithUrl } = usePdf();
  const [tab, setTab] = useState<CertificateWorkspaceTab>("active");
  const [selectedCertificateId, setSelectedCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [reissuingCertificateId, setReissuingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [unarchivingCertificateId, setUnarchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [policyFilter, setPolicyFilter] = useState<CertificatePolicyFilter>("all");
  const [typeFilter, setTypeFilter] = useState<CertificateTypeFilter>("all");
  const [contactFilter, setContactFilter] = useState<CertificateContactFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CertificateStatusFilter>("all");
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
  const archivedCertificates = useMemo(
    () =>
      (certificates ?? [])
        .filter((row) => row.status === "archived")
        .sort((left, right) =>
          Number(right.archivedAt ?? right.updatedAt ?? 0) -
          Number(left.archivedAt ?? left.updatedAt ?? 0),
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
  const selectedCertificate = useMemo(
    () =>
      (certificates ?? []).find((row) => row._id === selectedCertificateId) ??
      null,
    [certificates, selectedCertificateId],
  );
  const tableCertificates = tab === "archived" ? archivedCertificates : activeCertificates;
  const policyFilters = useMemo(
    () => certificatePolicyFilterOptions(tableCertificates),
    [tableCertificates],
  );
  const typeFilters = useMemo(
    () => certificateTypeFilterOptions(tableCertificates),
    [tableCertificates],
  );
  const statusFilters = useMemo(
    () => certificateStatusFilterOptions(tableCertificates),
    [tableCertificates],
  );
  const effectivePolicyFilter = policyFilters.some((option) => option.value === policyFilter)
    ? policyFilter
    : "all";
  const effectiveTypeFilter = typeFilters.some((option) => option.value === typeFilter)
    ? typeFilter
    : "all";
  const effectiveStatusFilter = statusFilters.some((option) => option.value === statusFilter)
    ? statusFilter
    : "all";
  const visibleCertificates = useMemo(
    () =>
      filterCertificates({
        rows: tableCertificates,
        policyFilter: effectivePolicyFilter,
        typeFilter: effectiveTypeFilter,
        contactFilter,
        statusFilter: effectiveStatusFilter,
      }),
    [
      contactFilter,
      effectivePolicyFilter,
      effectiveStatusFilter,
      effectiveTypeFilter,
      tableCertificates,
    ],
  );

  const isLoading =
    viewerOrg === undefined || certificates === undefined || jobs === undefined;

  const archiveCertificate = async (row: PolicyCertificateRecord) => {
    setArchivingCertificateId(row._id);
    try {
      await archiveCertificateMutation({ certificateId: row._id });
      setTab("archived");
      toast.success("Certificate archived");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive certificate",
      );
    } finally {
      setArchivingCertificateId(null);
    }
  };

  const unarchiveCertificate = async (row: PolicyCertificateRecord) => {
    setUnarchivingCertificateId(row._id);
    try {
      await unarchiveCertificateMutation({ certificateId: row._id });
      setTab("active");
      toast.success("Certificate restored");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not restore certificate",
      );
    } finally {
      setUnarchivingCertificateId(null);
    }
  };

  const reissueCertificate = async (row: PolicyCertificateRecord) => {
    const holder = row.holder;
    if (!holder?.displayName) {
      toast.error("Certificate holder is missing");
      return;
    }
    setReissuingCertificateId(row._id);
    try {
      const currentVersion = row.currentVersion ?? row.latestIssuedVersion;
      const result = await generateCertificate({
        policyId: row.policyId,
        holderName: holder.displayName,
        holderContactName: holder.contactName,
        holderEmail: holder.email,
        holderPhone: holder.phone,
        ...certificateHolderActionAddress(holder),
        additionalInsuredName: currentVersion?.requestKind === "additional_insured"
          ? currentVersion.additionalInsuredName
          : undefined,
        requestedEndorsements: currentVersion?.requestKind === "additional_insured"
          ? ["additional_insured"]
          : undefined,
        forceReissue: true,
      });
      if ((result as { status?: string }).status === "ambiguous_certificate_holder") {
        toast.message((result as { message?: string }).message ?? "Choose the existing certificate to reissue.");
        return;
      }
      if ((result as { status?: string }).status === "held_policy_change_required") {
        toast.message((result as { message?: string }).message ?? "Broker review is needed before reissue.");
        return;
      }
      toast.success("Certificate reissued");
      if ((result as { url?: string }).url) {
        openWithUrl((result as { url: string }).url);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reissue certificate");
    } finally {
      setReissuingCertificateId(null);
    }
  };

  return (
    <AppShell
      rightPanel={selectedCertificate ? (
        <CertificateDetailPanel
          row={selectedCertificate}
          onClose={() => setSelectedCertificateId(null)}
          onReissue={reissueCertificate}
          onArchive={archiveCertificate}
          onUnarchive={unarchiveCertificate}
          reissuing={reissuingCertificateId === selectedCertificate._id}
          archiving={archivingCertificateId === selectedCertificate._id}
          unarchiving={unarchivingCertificateId === selectedCertificate._id}
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
        ) : tableCertificates.length > 0 ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <CertificatesFilterSelect
                label="Policy"
                value={effectivePolicyFilter}
                onValueChange={(value) => setPolicyFilter(value as CertificatePolicyFilter)}
              >
                {policyFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </CertificatesFilterSelect>
              <CertificatesFilterSelect
                label="Type"
                value={effectiveTypeFilter}
                onValueChange={(value) => setTypeFilter(value as CertificateTypeFilter)}
              >
                {typeFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </CertificatesFilterSelect>
              <CertificatesFilterSelect
                label="Holder email"
                value={contactFilter}
                onValueChange={(value) => setContactFilter(value as CertificateContactFilter)}
              >
                {(["all", "has_email", "missing_email"] as CertificateContactFilter[]).map((filter) => (
                  <SelectItem key={filter} value={filter}>
                    {certificateContactFilterLabel(filter)}
                  </SelectItem>
                ))}
              </CertificatesFilterSelect>
              <CertificatesFilterSelect
                label="Status"
                value={effectiveStatusFilter}
                onValueChange={(value) => setStatusFilter(value as CertificateStatusFilter)}
              >
                {statusFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </CertificatesFilterSelect>
            </div>
            {visibleCertificates.length > 0 ? (
              <CertificatesTable
                rows={visibleCertificates}
                selectedCertificateId={selectedCertificateId}
                onSelectCertificate={(row) => setSelectedCertificateId(row._id)}
                onOpenPdf={openWithUrl}
              />
            ) : (
              <CertificateEmptyPanel title="No certificates match these filters" />
            )}
          </>
        ) : (
          <CertificateEmptyPanel
            title={tab === "archived" ? "No archived certificates" : "No active certificates"}
            description={
              tab === "archived"
                ? undefined
                : "Generate a COI from a policy to create the first holder-based certificate."
            }
          />
        )}
      </div>
    </AppShell>
  );
}
