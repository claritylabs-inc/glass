"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

type OnboardingStatus = "onboarding" | "active";

export function ClientDetailHeader({
  clientName,
  primaryContactName,
  primaryContactEmail,
  onboardingStatus,
  brokerOrgName,
}: {
  clientName: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  onboardingStatus: OnboardingStatus;
  brokerOrgName: string;
}) {
  const STATUS_LABELS: Record<OnboardingStatus, string> = {
    onboarding: "Onboarding",
    active: "Active",
  };
  const STATUS_VARIANTS: Record<OnboardingStatus, "secondary" | "default"> = {
    onboarding: "secondary",
    active: "default",
  };

  return (
    <div className="flex flex-col gap-2 pb-4 border-b mb-4">
      <div className="flex items-center gap-2">
        <Link
          href="/clients"
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <span className="text-xs text-muted-foreground">
          Viewing as broker for{" "}
          <span className="font-medium text-foreground">{brokerOrgName}</span>
        </span>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{clientName}</h1>
          {(primaryContactName || primaryContactEmail) && (
            <p className="text-sm text-muted-foreground">
              {primaryContactName}
              {primaryContactName && primaryContactEmail && " · "}
              {primaryContactEmail}
            </p>
          )}
        </div>
        <Badge variant={STATUS_VARIANTS[onboardingStatus]}>
          {STATUS_LABELS[onboardingStatus]}
        </Badge>
      </div>
    </div>
  );
}
