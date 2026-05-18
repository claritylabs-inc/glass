"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, FileCheck2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

function policyLabel(policy?: ApprovalQueue["certificateRequests"][number]["policy"]) {
  if (!policy) return "Policy not attached";
  return [
    policy.mga || policy.security || policy.carrier || "Policy",
    policy.policyNumber,
    policy.insuredName,
  ].filter(Boolean).join(" - ");
}

export default function ProgramAdminApprovalsPage() {
  const queue = useQuery(api.partnerPrograms.listApprovalQueue, {}) as ApprovalQueue | undefined;
  const approveCertificate = useAction(api.partnerPrograms.approveCertificateRequest);
  const declineCertificate = useMutation(api.partnerPrograms.declineCertificateRequest);
  const approvePce = useMutation(api.partnerPrograms.approvePolicyChangeCase);
  const declinePce = useMutation(api.partnerPrograms.declinePolicyChangeCase);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setWorkingId(id);
    try {
      await action();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval action failed");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <AppShell breadcrumbDetail="Program approvals">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-heading-lg font-semibold text-foreground">Approvals</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Review certified COI and policy-change requests for partnered programs.
          </p>
        </div>

        {queue === undefined ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ) : queue.certificateRequests.length === 0 && queue.policyChangeCases.length === 0 ? (
          <div className="rounded-lg border border-foreground/6 bg-card px-6 py-10 text-center">
            <ShieldCheck className="mx-auto mb-3 h-6 w-6 text-muted-foreground/45" />
            <p className="text-body-sm font-medium text-foreground">No pending approvals</p>
            <p className="mt-1 text-label-sm text-muted-foreground">
              Certified COI and PCE requests assigned to this program administrator will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-body-sm font-medium text-foreground">Certified COIs</h2>
              {queue.certificateRequests.map((request) => (
                <div key={request._id} className="rounded-lg border border-foreground/6 bg-card px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-body-sm font-medium text-foreground">
                        <FileCheck2 className="h-4 w-4 text-muted-foreground" />
                        <span>{request.holderName}</span>
                      </div>
                      <p className="mt-1 text-label-sm text-muted-foreground">{policyLabel(request.policy)}</p>
                      {request.program?.name && (
                        <p className="mt-1 text-[11px] text-muted-foreground/70">{request.program.name}</p>
                      )}
                      {request.certificateHolder && (
                        <p className="mt-2 whitespace-pre-line text-label-sm text-muted-foreground">{request.certificateHolder}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <PillButton
                        variant="secondary"
                        size="compact"
                        disabled={workingId === request._id}
                        onClick={() => run(request._id, () => declineCertificate({ requestId: request._id }), "Certificate request declined")}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Decline
                      </PillButton>
                      <PillButton
                        size="compact"
                        disabled={workingId === request._id}
                        onClick={() => run(request._id, () => approveCertificate({ requestId: request._id }), "Certified certificate generated")}
                      >
                        {workingId === request._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Approve
                      </PillButton>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h2 className="text-body-sm font-medium text-foreground">Policy Changes</h2>
              {queue.policyChangeCases.map((changeCase) => (
                <div key={changeCase._id} className="rounded-lg border border-foreground/6 bg-card px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">{changeCase.summary ?? "Policy change request"}</p>
                      <p className="mt-1 text-label-sm text-muted-foreground">{policyLabel(changeCase.policy)}</p>
                      <p className="mt-2 whitespace-pre-line text-body-sm text-muted-foreground">{changeCase.requestText}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <PillButton
                        variant="secondary"
                        size="compact"
                        disabled={workingId === changeCase._id}
                        onClick={() => run(changeCase._id, () => declinePce({ caseId: changeCase._id }), "Policy change declined")}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Decline
                      </PillButton>
                      <PillButton
                        size="compact"
                        disabled={workingId === changeCase._id}
                        onClick={() => run(changeCase._id, () => approvePce({ caseId: changeCase._id }), "Policy change approved and staged")}
                      >
                        {workingId === changeCase._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Approve
                      </PillButton>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
