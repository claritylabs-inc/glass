"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { FileText, ShieldCheck } from "lucide-react";
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

type PartnerPolicy = {
  _id: Id<"policies">;
  displayName: string;
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: string;
  pipelineStatus?: string;
  fileName?: string;
  fileUrl?: string | null;
  createdAt: number;
  updatedAt?: number;
  program?: {
    _id: Id<"partnerPrograms">;
    name: string;
    categoryLabels?: string[];
  } | null;
  broker: PartnerBroker;
};

const ALL_BROKERS = "__all_brokers__";

function formatDate(value?: string) {
  if (!value) return "No date";
  const parsed = dayjs(value, ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD"], true);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : value;
}

function brokerKey(broker: PartnerBroker) {
  return broker.brokerOrgId ?? broker.brokerName;
}

function normalizedLabel(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function policyCarrierName(policy: PartnerPolicy) {
  return policy.carrier ?? policy.security ?? policy.mga;
}

function nonDuplicateCarrierName(policy: PartnerPolicy) {
  const carrier = policyCarrierName(policy);
  if (!carrier) return undefined;
  return normalizedLabel(carrier) === normalizedLabel(policy.program?.name) ? undefined : carrier;
}

function PolicyDetailPanel({
  policy,
  onClose,
}: {
  policy: PartnerPolicy | null;
  onClose: () => void;
}) {
  const { openWithUrl } = usePdf();

  return (
    <SettingsDrawer
      open={Boolean(policy)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Policy details"
      footer={
        policy?.fileUrl ? (
          <PillButton type="button" onClick={() => openWithUrl(policy.fileUrl!)}>
            <FileText className="size-3.5" />
            Open PDF
          </PillButton>
        ) : null
      }
    >
      {policy ? (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {policy.program ? (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {policy.program.name}
                </Badge>
              ) : null}
              {policy.pipelineStatus ? (
                <Badge variant="secondary" className="font-normal text-muted-foreground">
                  {policy.pipelineStatus.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
            <h2 className="text-base font-medium text-foreground">{policy.displayName}</h2>
            <p className="text-base text-muted-foreground">
              {policy.updatedAt ? `Updated ${dayjs(policy.updatedAt).format("MMM D, YYYY h:mm A")}` : `Created ${dayjs(policy.createdAt).format("MMM D, YYYY h:mm A")}`}
            </p>
          </section>

          <OperationalDetailGroup title="Policy">
            <OperationalDetailRow label="Insured" value={policy.insuredName} />
            <OperationalDetailRow label="Policy no." value={policy.policyNumber} />
            <OperationalDetailRow label="Carrier" value={policy.carrier ?? policy.security ?? policy.mga} />
            <OperationalDetailRow label="Term" value={`${formatDate(policy.effectiveDate)} - ${formatDate(policy.expirationDate)}`} />
            <OperationalDetailRow label="Premium" value={policy.premium} />
            <OperationalDetailRow label="File" value={policy.fileName} />
          </OperationalDetailGroup>

          <OperationalDetailGroup title="Program and broker">
            <OperationalDetailRow label="Program" value={policy.program?.name ?? "No program"} />
            <OperationalDetailRow
                label="Labels"
                value={policy.program?.categoryLabels?.length ? policy.program.categoryLabels.join(", ") : undefined}
              />
            <OperationalDetailRow label="Broker" value={policy.broker.brokerName} />
            <OperationalDetailRow label="Client" value={policy.broker.clientOrgName} />
          </OperationalDetailGroup>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}

function PolicyList({
  policies,
  brokerFilter,
  onSelectPolicy,
}: {
  policies: PartnerPolicy[] | undefined;
  brokerFilter: string;
  onSelectPolicy: (policy: PartnerPolicy) => void;
}) {
  const { openWithUrl } = usePdf();

  const filteredPolicies = useMemo(
    () =>
      (policies ?? []).filter((policy) =>
        brokerFilter === ALL_BROKERS ? true : brokerKey(policy.broker) === brokerFilter,
      ),
    [brokerFilter, policies],
  );

  const tablePolicies = useMemo(() => {
    return [...filteredPolicies].sort((a, b) => {
      const brokerCompare = a.broker.brokerName.localeCompare(b.broker.brokerName);
      if (brokerCompare !== 0) return brokerCompare;
      return (a.insuredName ?? a.displayName).localeCompare(b.insuredName ?? b.displayName);
    });
  }, [filteredPolicies]);

  return (
    <div className="flex w-full flex-col gap-4">
      {policies === undefined ? (
        <OperationalSkeletonList />
      ) : policies.length === 0 ? (
        <EmptyStateCard
          icon={<ShieldCheck className="size-5" />}
          title="No connected policies"
          description="Policies connected to this program administrator will appear here as brokers and clients generate certified COIs."
        />
      ) : (
        <OperationalPanel>
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[18%] px-4 text-label text-muted-foreground">Insured</TableHead>
                <TableHead className="w-[14%] text-label text-muted-foreground">Policy no.</TableHead>
                <TableHead className="w-[16%] text-label text-muted-foreground">Carrier</TableHead>
                <TableHead className="w-[14%] text-label text-muted-foreground">Program</TableHead>
                <TableHead className="w-[14%] text-label text-muted-foreground">Broker</TableHead>
                <TableHead className="w-[14%] text-label text-muted-foreground">Term</TableHead>
                <TableHead className="w-[8%] text-label text-muted-foreground">Premium</TableHead>
                <TableHead className="w-[8%] text-label text-muted-foreground">Status</TableHead>
                <TableHead className="w-16 px-4 text-right text-label text-muted-foreground">File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tablePolicies.map((policy) => (
                <TableRow
                  key={policy._id}
                  tabIndex={0}
                  onClick={() => onSelectPolicy(policy)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelectPolicy(policy);
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <TableCell className="px-4">
                    <p className="truncate font-medium text-foreground">{policy.insuredName ?? policy.displayName}</p>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {policy.policyNumber ?? "No policy number"}
                  </TableCell>
                  <TableCell className="max-w-44 truncate text-foreground">
                    {nonDuplicateCarrierName(policy) ?? policyCarrierName(policy) ?? "Not recorded"}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {policy.program?.name ?? "No program"}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {policy.broker.brokerName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(policy.effectiveDate)} - {formatDate(policy.expirationDate)}
                  </TableCell>
                  <TableCell className="max-w-28 truncate text-muted-foreground">
                    {policy.premium ?? "-"}
                  </TableCell>
                  <TableCell>
                    {policy.pipelineStatus ? (
                      <Badge variant="secondary" className="font-normal text-muted-foreground">
                        {policy.pipelineStatus.replace(/_/g, " ")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    {policy.fileUrl ? (
                      <PillButton
                        type="button"
                        variant="secondary"
                        size="compact"
                        onClick={(event) => {
                          event.stopPropagation();
                          openWithUrl(policy.fileUrl!);
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
              ))}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </div>
  );
}

export default function PartnerPoliciesPage() {
  const policies = useCachedQuery(
    "partnerPrograms.listPartnerPolicies",
    api.partnerPrograms.listPartnerPolicies,
    {},
  ) as PartnerPolicy[] | undefined;
  const [brokerFilter, setBrokerFilter] = useState(ALL_BROKERS);
  const [selectedPolicy, setSelectedPolicy] = useState<PartnerPolicy | null>(null);

  const brokerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const policy of policies ?? []) {
      map.set(brokerKey(policy.broker), policy.broker.brokerName);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [policies]);

  return (
    <AppShell
      breadcrumbDetail="Policies"
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
      rightPanel={selectedPolicy ? (
        <PolicyDetailPanel
          policy={selectedPolicy}
          onClose={() => setSelectedPolicy(null)}
        />
      ) : null}
    >
      <PolicyList
        policies={policies}
        brokerFilter={brokerFilter}
        onSelectPolicy={setSelectedPolicy}
      />
    </AppShell>
  );
}
