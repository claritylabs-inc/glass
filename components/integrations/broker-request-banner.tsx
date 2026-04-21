// components/integrations/broker-request-banner.tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MergeLinkButton } from "./merge-link-button";
import { PillButton } from "@/components/ui/pill-button";
import { X } from "lucide-react";
import { toast } from "sonner";

interface BrokerRequestBannerProps {
  clientOrgId: string;
}

export function BrokerRequestBanner({ clientOrgId }: BrokerRequestBannerProps) {
  const requests = useQuery(
    (api as any).integrationRequests.listForClient,
    { clientOrgId },
  );

  const dismiss = useMutation((api as any).integrationRequests.dismiss);

  if (!requests || requests.length === 0) return null;

  return (
    <div className="space-y-2">
      {requests.map((req: {
        _id: string;
        category: "accounting" | "hris" | "payroll";
        message?: string;
        brokerOrgId: string;
      }) => (
        <div
          key={req._id}
          className="flex items-start gap-3 rounded-lg border border-amber-200/60 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-4"
        >
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-medium text-foreground">
              Your broker requested a {req.category} connection
            </p>
            {req.message && (
              <p className="text-label-sm text-muted-foreground/70 mt-0.5 italic">
                &ldquo;{req.message}&rdquo;
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <MergeLinkButton
              clientOrgId={clientOrgId}
              category={req.category}
              integrationRequestId={req._id}
              label="Connect"
              variant="secondary"
              onLinked={() => toast.success("Integration connected")}
            />
            <PillButton
              variant="ghost"
              onClick={() => dismiss({ requestId: req._id })}
              className="text-muted-foreground/50"
            >
              <X className="w-3.5 h-3.5" />
            </PillButton>
          </div>
        </div>
      ))}
    </div>
  );
}
