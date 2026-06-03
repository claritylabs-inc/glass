"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import {
  CheckCircle2,
  FileCheck2,
  Loader2,
  PencilLine,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Badge } from "@/components/ui/badge";
import {
  OperationalItem,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type ApprovalQueue = {
  certificateRequests: Array<{
    _id: Id<"certificateRequests">;
    holderName: string;
    certificateHolder?: string;
    createdAt: number;
    policy?: { carrier?: string; security?: string; mga?: string; policyNumber?: string; insuredName?: string } | null;
    program?: { name?: string } | null;
  }>;
  policyChangeCases: Array<{
    _id: Id<"policyChangeCases">;
    summary?: string;
    requestText: string;
    createdAt: number;
    policy?: { carrier?: string; security?: string; mga?: string; policyNumber?: string; insuredName?: string } | null;
    program?: { name?: string } | null;
  }>;
};

type ApprovalFilter = "all" | "certificates" | "policy_changes";
type ApprovalKind = "certificate" | "policy_change";

function policyLabel(policy?: ApprovalQueue["certificateRequests"][number]["policy"]) {
  if (!policy) return "Policy not attached";
  return [
    policy.mga || policy.security || policy.carrier || "Policy",
    policy.policyNumber,
    policy.insuredName,
  ].filter(Boolean).join(" - ");
}

function formatCreatedAt(value: number) {
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

function ProgramApprovalsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <OperationalPanel as="div">
        {Array.from({ length: 4 }).map((_, index) => (
          <OperationalItem
            key={index}
            className="flex items-center justify-between gap-4 border-foreground/4"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Skeleton className="size-8 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          </OperationalItem>
        ))}
      </OperationalPanel>
    </div>
  );
}

function ApprovalRow({
  kind,
  title,
  subtitle,
  description,
  programName,
  createdAt,
  working,
  onApprove,
  onDecline,
}: {
  kind: ApprovalKind;
  title: string;
  subtitle: string;
  description?: string;
  programName?: string;
  createdAt: number;
  working: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const Icon = kind === "certificate" ? FileCheck2 : PencilLine;
  const label = kind === "certificate" ? "Certified COI" : "Policy change";
  const approveLabel = kind === "certificate" ? "Approve" : "Stage";

  return (
    <OperationalItem className="flex flex-col gap-3 border-foreground/4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/4 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-base font-medium text-foreground">
              {title}
            </p>
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              {label}
            </Badge>
            {programName ? (
              <Badge variant="outline" className="max-w-full font-normal text-muted-foreground">
                <span className="min-w-0 truncate">{programName}</span>
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-1 text-base text-muted-foreground">
            {subtitle}
          </p>
          {description ? (
            <p className="mt-2 line-clamp-2 whitespace-pre-line text-base leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
          <p className="mt-2 text-label text-muted-foreground/70">
            Requested {formatCreatedAt(createdAt)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 sm:pt-0.5">
        <PillButton
          variant="secondary"
          size="compact"
          disabled={working}
          onClick={onDecline}
        >
          <XCircle className="size-3.5" />
          Decline
        </PillButton>
        <PillButton size="compact" disabled={working} onClick={onApprove}>
          {working ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          {approveLabel}
        </PillButton>
      </div>
    </OperationalItem>
  );
}

export default function ProgramAdminApprovalsPage() {
  const queue = useCachedQuery(
    "partnerPrograms.listApprovalQueue",
    api.partnerPrograms.listApprovalQueue,
    {},
  ) as ApprovalQueue | undefined;
  const approveCertificate = useAction(api.partnerPrograms.approveCertificateRequest);
  const declineCertificate = useMutation(api.partnerPrograms.declineCertificateRequest);
  const approvePce = useMutation(api.partnerPrograms.approvePolicyChangeCase);
  const declinePce = useMutation(api.partnerPrograms.declinePolicyChangeCase);
  const updateQueue = useUpdateCachedQuery<ApprovalQueue, Record<string, never>>(
    "partnerPrograms.listApprovalQueue",
  );
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ApprovalFilter>("all");

  const certificateRequests = queue?.certificateRequests ?? [];
  const policyChangeCases = queue?.policyChangeCases ?? [];
  const totalPending = certificateRequests.length + policyChangeCases.length;
  const visibleCertificateRequests =
    filter === "all" || filter === "certificates" ? certificateRequests : [];
  const visiblePolicyChangeCases =
    filter === "all" || filter === "policy_changes" ? policyChangeCases : [];

  async function run(
    id: string,
    action: () => Promise<unknown>,
    message: string,
    kind: ApprovalKind,
  ) {
    setWorkingId(id);
    try {
      await action();
      await updateQueue({}, (current) =>
        kind === "certificate"
          ? {
              ...current,
              certificateRequests: current.certificateRequests.filter(
                (request) => request._id !== id,
              ),
            }
          : {
              ...current,
              policyChangeCases: current.policyChangeCases.filter(
                (changeCase) => changeCase._id !== id,
              ),
            },
      );
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval action failed");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <AppShell breadcrumbDetail="Program approvals">
      <div className="flex w-full flex-col gap-4">
        {queue === undefined ? (
          <ProgramApprovalsLoadingSkeleton />
        ) : totalPending === 0 ? (
          <EmptyStateCard
            icon={<ShieldCheck className="size-5" />}
            title="No pending approvals"
            description="Certified COI and policy change requests assigned to this program administrator will appear here."
          />
        ) : (
          <>
            <Tabs value={filter} onValueChange={(value) => setFilter(value as ApprovalFilter)}>
              <TabsList variant="pill">
                <TabsTrigger value="all">All {totalPending}</TabsTrigger>
                <TabsTrigger value="certificates">
                  Certified COIs {certificateRequests.length}
                </TabsTrigger>
                <TabsTrigger value="policy_changes">
                  Policy changes {policyChangeCases.length}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <OperationalPanel>
              {visibleCertificateRequests.map((request) => (
                <ApprovalRow
                  key={request._id}
                  kind="certificate"
                  title={request.holderName}
                  subtitle={policyLabel(request.policy)}
                  description={request.certificateHolder}
                  programName={request.program?.name}
                  createdAt={request.createdAt}
                  working={workingId === request._id}
                  onDecline={() =>
                    run(
                      request._id,
                      () => declineCertificate({ requestId: request._id }),
                      "Certificate request declined",
                      "certificate",
                    )
                  }
                  onApprove={() =>
                    run(
                      request._id,
                      () => approveCertificate({ requestId: request._id }),
                      "Certified certificate generated",
                      "certificate",
                    )
                  }
                />
              ))}
              {visiblePolicyChangeCases.map((changeCase) => (
                <ApprovalRow
                  key={changeCase._id}
                  kind="policy_change"
                  title={changeCase.summary ?? "Policy change request"}
                  subtitle={policyLabel(changeCase.policy)}
                  description={changeCase.requestText}
                  programName={changeCase.program?.name}
                  createdAt={changeCase.createdAt}
                  working={workingId === changeCase._id}
                  onDecline={() =>
                    run(
                      changeCase._id,
                      () => declinePce({ caseId: changeCase._id }),
                      "Policy change declined",
                      "policy_change",
                    )
                  }
                  onApprove={() =>
                    run(
                      changeCase._id,
                      () => approvePce({ caseId: changeCase._id }),
                      "Policy change approved and staged",
                      "policy_change",
                    )
                  }
                />
              ))}
            </OperationalPanel>
          </>
        )}
      </div>
    </AppShell>
  );
}
