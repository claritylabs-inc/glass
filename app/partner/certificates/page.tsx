"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { BadgeCheck, FileText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import {
  OperationalDetailGroup,
  OperationalDetailRow,
  OperationalPanel,
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
import { usePdf } from "@/components/pdf-context";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import type { Id } from "@/convex/_generated/dataModel";

type PartnerBroker = {
  brokerOrgId?: Id<"organizations">;
  brokerName: string;
  clientOrgId?: Id<"organizations">;
  clientOrgName?: string;
};

type PartnerCertificate = {
  _id: Id<"certificates">;
  fileName: string;
  fileUrl: string | null;
  certificateHolderName: string;
  certificateHolder?: string;
  source?: string;
  authorityType?: "non_binding" | "certified";
  certificationStatus?: "not_applicable" | "pending" | "certified" | "declined";
  createdAt: number;
  policy: {
    _id: Id<"policies">;
    displayName: string;
    carrier?: string;
    security?: string;
    mga?: string;
    policyNumber?: string;
    insuredName?: string;
    effectiveDate?: string;
    expirationDate?: string;
  } | null;
  program?: {
    _id: Id<"partnerPrograms">;
    name: string;
    categoryLabels?: string[];
  } | null;
  broker: PartnerBroker;
};

const ALL_BROKERS = "__all_brokers__";

function brokerKey(broker: PartnerBroker) {
  return broker.brokerOrgId ?? broker.brokerName;
}

function normalizedLabel(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function nonDuplicateProgramName(certificate: PartnerCertificate) {
  const programName = certificate.program?.name;
  if (!programName) return undefined;
  const normalizedProgram = normalizedLabel(programName);
  const policyParts = [
    certificate.policy?.displayName,
    certificate.policy?.carrier,
    certificate.policy?.security,
    certificate.policy?.mga,
  ].map(normalizedLabel);
  return policyParts.some((part) => part === normalizedProgram || part.includes(normalizedProgram))
    ? undefined
    : programName;
}

function holderAddress(certificate: PartnerCertificate) {
  const holder = certificate.certificateHolderName.trim();
  const address = certificate.certificateHolder?.trim();
  if (!address) return undefined;
  if (normalizedLabel(address) === normalizedLabel(holder)) return undefined;

  const lowerAddress = address.toLowerCase();
  const lowerHolder = holder.toLowerCase();
  if (holder && lowerAddress.startsWith(lowerHolder)) {
    const cleaned = address.slice(holder.length).replace(/^[\s,.-]+/, "").trim();
    return cleaned || undefined;
  }

  return address;
}

function formatTimestamp(value: number) {
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

function authorityLabel(certificate: PartnerCertificate) {
  if (certificate.authorityType === "certified") return "Certified";
  return "Non-binding";
}

function CertificateDetailPanel({
  certificate,
  onClose,
}: {
  certificate: PartnerCertificate | null;
  onClose: () => void;
}) {
  const { openWithUrl } = usePdf();

  return (
    <SettingsDrawer
      open={Boolean(certificate)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Certificate details"
      footer={
        certificate?.fileUrl ? (
          <PillButton type="button" onClick={() => openWithUrl(certificate.fileUrl!)}>
            <FileText className="size-3.5" />
            Open PDF
          </PillButton>
        ) : null
      }
    >
      {certificate ? (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={certificate.authorityType === "certified" ? "secondary" : "outline"}
                className="font-normal text-muted-foreground"
              >
                {authorityLabel(certificate)}
              </Badge>
              {certificate.certificationStatus && certificate.certificationStatus !== "not_applicable" ? (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {certificate.certificationStatus.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
            <h2 className="text-base font-medium text-foreground">{certificate.certificateHolderName}</h2>
            <p className="text-base text-muted-foreground">{formatTimestamp(certificate.createdAt)}</p>
          </section>

          <OperationalDetailGroup title="Certificate">
            <OperationalDetailRow label="Holder" value={certificate.certificateHolderName} />
            <OperationalDetailRow label="Address" value={certificate.certificateHolder} />
            <OperationalDetailRow label="Source" value={certificate.source?.replace(/_/g, " ")} />
            <OperationalDetailRow label="File" value={certificate.fileName} />
          </OperationalDetailGroup>

          <OperationalDetailGroup title="Policy">
            <OperationalDetailRow label="Policy" value={certificate.policy?.displayName} />
            <OperationalDetailRow label="Insured" value={certificate.policy?.insuredName} />
            <OperationalDetailRow label="Policy no." value={certificate.policy?.policyNumber} />
            <OperationalDetailRow
                label="Carrier"
                value={certificate.policy?.carrier ?? certificate.policy?.security ?? certificate.policy?.mga}
              />
            <OperationalDetailRow
                label="Term"
                value={
                  certificate.policy?.effectiveDate || certificate.policy?.expirationDate
                    ? `${certificate.policy?.effectiveDate ?? "No effective date"} - ${certificate.policy?.expirationDate ?? "No expiration date"}`
                    : undefined
                }
              />
          </OperationalDetailGroup>

          <OperationalDetailGroup title="Program and broker">
            <OperationalDetailRow label="Program" value={certificate.program?.name ?? "No program"} />
            <OperationalDetailRow label="Broker" value={certificate.broker.brokerName} />
            <OperationalDetailRow label="Client" value={certificate.broker.clientOrgName} />
          </OperationalDetailGroup>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}

function CertificateList({
  certificates,
  brokerFilter,
  onSelectCertificate,
}: {
  certificates: PartnerCertificate[] | undefined;
  brokerFilter: string;
  onSelectCertificate: (certificate: PartnerCertificate) => void;
}) {
  const { openWithUrl } = usePdf();

  const filteredCertificates = useMemo(
    () =>
      (certificates ?? []).filter((certificate) =>
        brokerFilter === ALL_BROKERS ? true : brokerKey(certificate.broker) === brokerFilter,
      ),
    [brokerFilter, certificates],
  );

  const tableCertificates = useMemo(() => {
    return [...filteredCertificates].sort((a, b) => {
      const brokerCompare = a.broker.brokerName.localeCompare(b.broker.brokerName);
      if (brokerCompare !== 0) return brokerCompare;
      return b.createdAt - a.createdAt;
    });
  }, [filteredCertificates]);

  return (
    <div className="flex w-full flex-col gap-4">
      {certificates === undefined ? (
        <OperationalSkeletonList />
      ) : certificates.length === 0 ? (
        <EmptyStateCard
          icon={<BadgeCheck className="size-5" />}
          title="No generated certificates"
          description="Certified and non-binding certificates generated for this program administrator's policies will appear here."
        />
      ) : (
        <OperationalPanel>
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[14%] px-4 text-label text-muted-foreground">Holder</TableHead>
                <TableHead className="w-[18%] text-label text-muted-foreground">Address</TableHead>
                <TableHead className="w-[12%] text-label text-muted-foreground">Insured</TableHead>
                <TableHead className="w-[15%] text-label text-muted-foreground">Policy</TableHead>
                <TableHead className="w-[12%] text-label text-muted-foreground">Program</TableHead>
                <TableHead className="w-[12%] text-label text-muted-foreground">Broker</TableHead>
                <TableHead className="w-[10%] text-label text-muted-foreground">Issued</TableHead>
                <TableHead className="w-[7%] text-label text-muted-foreground">Type</TableHead>
                <TableHead className="w-16 px-4 text-right text-label text-muted-foreground">File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableCertificates.map((certificate) => {
                const address = holderAddress(certificate);
                return (
                  <TableRow
                    key={certificate._id}
                    tabIndex={0}
                    onClick={() => onSelectCertificate(certificate)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelectCertificate(certificate);
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <TableCell className="max-w-44 truncate px-4 font-medium text-foreground">
                      {certificate.certificateHolderName}
                    </TableCell>
                    <TableCell className="max-w-60 truncate text-muted-foreground">
                      {address ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-36 truncate text-muted-foreground">
                      {certificate.policy?.insuredName ?? certificate.broker.clientOrgName ?? "No client recorded"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-foreground">
                      {certificate.policy?.policyNumber ?? certificate.policy?.displayName ?? "Policy not found"}
                    </TableCell>
                    <TableCell className="max-w-36 truncate text-muted-foreground">
                      {nonDuplicateProgramName(certificate) ?? certificate.program?.name ?? "No program"}
                    </TableCell>
                    <TableCell className="max-w-36 truncate text-muted-foreground">
                      {certificate.broker.brokerName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(certificate.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={certificate.authorityType === "certified" ? "secondary" : "outline"}
                        className="font-normal text-muted-foreground"
                      >
                        {authorityLabel(certificate)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      {certificate.fileUrl ? (
                        <PillButton
                          type="button"
                          variant="secondary"
                          size="compact"
                          onClick={(event) => {
                            event.stopPropagation();
                            openWithUrl(certificate.fileUrl!);
                          }}
                        >
                          <FileText className="size-3.5" />
                          PDF
                        </PillButton>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </div>
  );
}

export default function PartnerCertificatesPage() {
  const certificates = useCachedQuery(
    "partnerPrograms.listPartnerCertificates",
    api.partnerPrograms.listPartnerCertificates,
    {},
  ) as PartnerCertificate[] | undefined;
  const [brokerFilter, setBrokerFilter] = useState(ALL_BROKERS);
  const [selectedCertificate, setSelectedCertificate] = useState<PartnerCertificate | null>(null);

  const brokerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const certificate of certificates ?? []) {
      map.set(brokerKey(certificate.broker), certificate.broker.brokerName);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [certificates]);

  return (
    <AppShell
      breadcrumbDetail="Certificates"
      actions={
        brokerOptions.length > 1 ? (
          <Select value={brokerFilter} onValueChange={(value) => setBrokerFilter(value ?? ALL_BROKERS)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BROKERS}>All brokers</SelectItem>
              {brokerOptions.map((broker) => (
                <SelectItem key={broker.value} value={broker.value}>
                  {broker.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
      rightPanel={selectedCertificate ? (
        <CertificateDetailPanel
          certificate={selectedCertificate}
          onClose={() => setSelectedCertificate(null)}
        />
      ) : null}
    >
      <CertificateList
        certificates={certificates}
        brokerFilter={brokerFilter}
        onSelectCertificate={setSelectedCertificate}
      />
    </AppShell>
  );
}
