"use client";

import { Badge } from "@/components/ui/badge";

type OnboardingStatus = "onboarding" | "active";

export function ClientDetailHeader({
  clientName,
  onboardingStatus,
}: {
  clientName: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  onboardingStatus: OnboardingStatus;
  brokerOrgName?: string;
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
    <div className="flex items-center justify-between gap-4 pb-4 border-b border-foreground/6 mb-4">
      <h1 className="text-xl font-semibold truncate">{clientName}</h1>
      <Badge variant={STATUS_VARIANTS[onboardingStatus]} className="shrink-0">
        {STATUS_LABELS[onboardingStatus]}
      </Badge>
    </div>
  );
}
