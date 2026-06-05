"use client";

import dayjs from "dayjs";
import { type KeyboardEvent, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import {
  OperationalDetailRow,
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";

export type CertificateHolderRecord = {
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

export type CertificatePolicyRecord = {
  _id: Id<"policies">;
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
};

export type CertificateVersionRecord = {
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

export type PolicyCertificateRecord = {
  _id: Id<"policyCertificates">;
  policyId: Id<"policies">;
  holderId: Id<"certificateHolders">;
  status: string;
  lastIssuedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  holder?: CertificateHolderRecord | null;
  policy?: CertificatePolicyRecord | null;
  currentVersion?: CertificateVersionRecord | null;
  latestIssuedVersion?: CertificateVersionRecord | null;
  versions?: CertificateVersionRecord[];
  url?: string | null;
};

export const CERTIFICATE_PANEL_CONTAINER_CLASS = "@container/certificates-panel";

const CERTIFICATE_ACTIVE_ROW_GRID_CLASS =
  "grid min-w-0 gap-3 @xl/certificates-panel:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] @xl/certificates-panel:items-center";
const CERTIFICATE_ROW_CLICKABLE_CLASS =
  "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-inset";

export function certificatePolicyLabel(policy?: CertificatePolicyRecord | null) {
  return [
    policy?.policyNumber,
    policy?.carrier ?? policy?.security ?? policy?.mga,
  ].filter(Boolean).join(" · ") || "Policy";
}

export function certificateHolderAddress(holder?: CertificateHolderRecord | null) {
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

export function formatCertificateTime(value?: number) {
  return value ? dayjs(value).format("MMM D, YYYY h:mm A") : "Not issued";
}

export function certificateBadge(row: PolicyCertificateRecord) {
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

function versionBadge(version?: CertificateVersionRecord | null) {
  if (!version) return { label: "No version", variant: "outline" as const };
  if (version.status === "issued") return { label: "Issued", variant: "secondary" as const };
  if (version.status === "void") return { label: "Void", variant: "destructive" as const };
  return {
    label: version.status.replace(/_/g, " "),
    variant: "outline" as const,
  };
}

function sortedVersions(row: PolicyCertificateRecord) {
  return [...(row.versions?.length ? row.versions : row.currentVersion ? [row.currentVersion] : [])]
    .sort((left, right) => right.versionNumber - left.versionNumber);
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

function CertificateDetailCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader title={title} />
      <div className="px-3 py-0.5">{children}</div>
    </OperationalPanel>
  );
}

function PolicyTitle({ policy }: { policy?: CertificatePolicyRecord | null }) {
  return (
    <p className="block max-w-full truncate text-base font-medium text-foreground">
      {certificatePolicyLabel(policy)}
    </p>
  );
}

export function CertificateRow({
  row,
  selected,
  onSelect,
}: {
  row: PolicyCertificateRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = certificateBadge(row);
  const version = row.currentVersion;
  return (
    <OperationalItem
      aria-label={`Open certificate details for ${row.holder?.displayName ?? "certificate holder"}`}
      aria-pressed={selected}
      className={`${CERTIFICATE_ROW_CLICKABLE_CLASS} ${selected ? "bg-muted/40" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => openOnKeyboard(event, onSelect)}
      role="button"
      tabIndex={0}
    >
      <div className={CERTIFICATE_ACTIVE_ROW_GRID_CLASS}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate text-base font-medium text-foreground">
              {row.holder?.displayName ?? "Certificate holder"}
            </p>
            <Badge variant={badge.variant} className="shrink-0 text-label capitalize">
              {badge.label}
            </Badge>
          </div>
          <p className="mt-1 whitespace-pre-line text-base text-muted-foreground">
            {certificateHolderAddress(row.holder) ?? row.holder?.email ?? "No holder contact recorded"}
          </p>
        </div>
        <div className="min-w-0">
          <PolicyTitle policy={row.policy} />
          <p className="mt-1 text-base text-muted-foreground">
            Version {version?.versionNumber ?? "-"} · {formatCertificateTime(version?.issuedAt ?? row.lastIssuedAt)}
          </p>
        </div>
      </div>
    </OperationalItem>
  );
}

function CertificateVersionRow({
  version,
  isCurrent,
}: {
  version: CertificateVersionRecord;
  isCurrent: boolean;
}) {
  const badge = versionBadge(version);
  return (
    <CertificatePdfItem
      url={version.url}
      ariaLabel={`Open certificate version ${version.versionNumber} PDF`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">
            Version {version.versionNumber}
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            {formatCertificateTime(version.issuedAt ?? version.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {isCurrent ? (
            <Badge variant="secondary" className="text-label">
              Current
            </Badge>
          ) : null}
          <Badge variant={badge.variant} className="text-label capitalize">
            {badge.label}
          </Badge>
        </div>
      </div>
    </CertificatePdfItem>
  );
}

export function CertificateDetailPanel({
  row,
  onClose,
}: {
  row: PolicyCertificateRecord | null;
  onClose: () => void;
}) {
  const { openWithUrl } = usePdf();
  const versions = row ? sortedVersions(row) : [];
  const currentVersion = row?.currentVersion;
  const badge = row ? certificateBadge(row) : null;
  const currentUrl = row?.url ?? currentVersion?.url;
  const holderName = row?.holder?.displayName ?? "Certificate holder";

  return (
    <SettingsDrawer
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={holderName}
      actions={
        row ? (
          <div className="flex shrink-0 items-center gap-2">
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
        ) : null
      }
      footer={
        currentUrl ? (
          <PillButton
            type="button"
            variant="primary"
            onClick={() => openWithUrl(currentUrl)}
          >
            View PDF
          </PillButton>
        ) : null
      }
    >
      {row ? (
        <div className="flex flex-col gap-5">
          <CertificateDetailCard title="Holder">
            <OperationalDetailRow label="Name" value={row.holder?.displayName} />
            <OperationalDetailRow label="Email" value={row.holder?.email} />
            <OperationalDetailRow label="Phone" value={row.holder?.phone} />
            <OperationalDetailRow label="Address" value={certificateHolderAddress(row.holder)} />
          </CertificateDetailCard>

          <CertificateDetailCard title="Policy">
            <OperationalDetailRow label="Policy no." value={row.policy?.policyNumber} />
            <OperationalDetailRow label="Carrier" value={row.policy?.carrier ?? row.policy?.security ?? row.policy?.mga} />
            <OperationalDetailRow label="Insured" value={row.policy?.insuredName} />
          </CertificateDetailCard>

          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Versions" />
            {versions.length > 0 ? (
              versions.map((version) => (
                <CertificateVersionRow
                  key={version._id}
                  version={version}
                  isCurrent={version._id === currentVersion?._id}
                />
              ))
            ) : (
              <OperationalPanelBody className="px-4 py-6">
                <p className="text-base text-muted-foreground">
                  No versions recorded.
                </p>
              </OperationalPanelBody>
            )}
          </OperationalPanel>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}
