"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import {
  CertificateDetailPanel,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
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

function certificateCarrier(row: PolicyCertificateRecord) {
  return row.policy?.carrier ?? row.policy?.security;
}

function certificateHolderAddressDisplay(row: PolicyCertificateRecord) {
  const address = row.holder?.address;
  const formattedLines = certificateHolderAddress(row.holder)
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  const street = [address?.line1, address?.line2].filter(Boolean).join(", ") ||
    (formattedLines.length > 1
      ? formattedLines.slice(0, -1).join(", ")
      : formattedLines[0]);
  const statePostal = [address?.state, address?.postalCode].filter(Boolean).join(" ");
  const locality = [address?.city, statePostal, address?.country].filter(Boolean).join(", ") ||
    (formattedLines.length > 1 ? formattedLines[formattedLines.length - 1] : undefined);
  return { street, locality };
}

function certificateContactSummary(row: PolicyCertificateRecord) {
  const contactName = row.holder?.contactName?.trim();
  const email = row.holder?.email?.trim();
  const phone = row.holder?.phone?.trim();
  const primary = contactName ?? email ?? phone ?? "No contact";
  const secondary = contactName ? email : undefined;
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

function filterCertificates({
  rows,
  policyFilter,
}: {
  rows: PolicyCertificateRecord[];
  policyFilter: CertificatePolicyFilter;
}) {
  return rows.filter((row) =>
    policyFilter === "all" || certificatePolicyFilterValue(row) === policyFilter,
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

function CertificatesPolicyFilter({
  value,
  label,
  options,
  onValueChange,
}: {
  value: CertificatePolicyFilter;
  label: string;
  options: Array<{ value: CertificatePolicyFilter; label: string }>;
  onValueChange: (value: CertificatePolicyFilter) => void;
}) {
  return (
    <label className="flex min-w-0 max-w-xl flex-col gap-1.5 text-label font-medium text-muted-foreground">
      Policy
      <Select
        value={value}
        onValueChange={(next) => next && onValueChange(next as CertificatePolicyFilter)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width) max-w-[36rem]">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="block max-w-[32rem] truncate">
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function CertificatesTable({
  rows,
  selectedCertificateId,
  onSelectCertificate,
}: {
  rows: PolicyCertificateRecord[];
  selectedCertificateId?: Id<"policyCertificates"> | null;
  onSelectCertificate: (row: PolicyCertificateRecord) => void;
}) {
  return (
    <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[22%] px-4">Holder</TableHead>
            <TableHead className="w-[24%]">Address</TableHead>
            <TableHead className="w-[18%]">Contact</TableHead>
            <TableHead className="w-[24%]">Policy</TableHead>
            <TableHead className="w-[12%] px-4">Issued</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const contact = certificateContactSummary(row);
            const address = certificateHolderAddressDisplay(row);
            const currentVersion = row.currentVersion;
            const selected = row._id === selectedCertificateId;
            const issuedAt = row.lastIssuedAt ?? currentVersion?.issuedAt ?? currentVersion?.createdAt;
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
                </TableCell>
                <TableCell className="max-w-72">
                  {address.street ? (
                    <>
                      <p className="truncate text-foreground">
                        {address.street}
                      </p>
                      {address.locality ? (
                        <p className="truncate text-label text-muted-foreground">
                          {address.locality}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">No address</span>
                  )}
                </TableCell>
                <TableCell className="max-w-56">
                  <p className={contact.primary === "No contact" ? "truncate text-muted-foreground" : "truncate text-foreground"}>
                    {contact.primary}
                  </p>
                  {contact.secondary ? (
                    <p className="truncate text-label text-muted-foreground">
                      {contact.secondary}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-72">
                  <p className="truncate text-foreground">
                    {row.policy?.policyNumber ?? "Policy"}
                  </p>
                  {carrier ? (
                    <p className="truncate text-label text-muted-foreground">
                      {carrier}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="px-4">
                  <p className="text-foreground">
                    {formatCertificateTime(issuedAt)}
                  </p>
                  {currentVersion ? (
                    <p className="text-label text-muted-foreground">
                      Version {currentVersion.versionNumber}
                    </p>
                  ) : null}
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
      summary: reviewCount > 0
        ? `${activeCount} active certificate${activeCount === 1 ? "" : "s"} · ${reviewCount} review job${reviewCount === 1 ? "" : "s"}`
        : `${activeCount} active certificate${activeCount === 1 ? "" : "s"}`,
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
  const hasReviewJobs = reviewJobs.length > 0;
  const visibleTab = tab === "review" && !hasReviewJobs ? "active" : tab;
  const visibleTabs = hasReviewJobs
    ? TABS
    : TABS.filter((item) => item.value !== "review");
  const tableCertificates = visibleTab === "archived" ? archivedCertificates : activeCertificates;
  const policyFilters = useMemo(
    () => certificatePolicyFilterOptions(tableCertificates),
    [tableCertificates],
  );
  const effectivePolicyFilter = policyFilters.some((option) => option.value === policyFilter)
    ? policyFilter
    : "all";
  const policyFilterLabel = policyFilters.find((option) => option.value === effectivePolicyFilter)?.label ??
    "All policies";
  const visibleCertificates = useMemo(
    () =>
      filterCertificates({
        rows: tableCertificates,
        policyFilter: effectivePolicyFilter,
      }),
    [effectivePolicyFilter, tableCertificates],
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
          value={visibleTab}
          onValueChange={(value) => setTab(value as CertificateWorkspaceTab)}
        >
          <TabsList variant="pill">
            {visibleTabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <OperationalSkeletonList rows={4} />
        ) : visibleTab === "review" ? (
          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Certificate review jobs" />
            {reviewJobs.map((job) => (
              <ReviewJobRow key={job._id} job={job} />
            ))}
          </OperationalPanel>
        ) : tableCertificates.length > 0 ? (
          <>
            <div>
              <CertificatesPolicyFilter
                value={effectivePolicyFilter}
                label={policyFilterLabel}
                options={policyFilters}
                onValueChange={setPolicyFilter}
              />
            </div>
            {visibleCertificates.length > 0 ? (
              <CertificatesTable
                rows={visibleCertificates}
                selectedCertificateId={selectedCertificateId}
                onSelectCertificate={(row) => setSelectedCertificateId(row._id)}
              />
            ) : (
              <CertificateEmptyPanel title="No certificates match these filters" />
            )}
          </>
        ) : (
          <CertificateEmptyPanel
            title={visibleTab === "archived" ? "No archived certificates" : "No active certificates"}
            description={
              visibleTab === "archived"
                ? undefined
                : "Generate a COI from a policy to create the first holder-based certificate."
            }
          />
        )}
      </div>
    </AppShell>
  );
}
