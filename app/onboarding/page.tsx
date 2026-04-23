"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

export default function OnboardingRoutePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});

  useEffect(() => {
    if (viewer === undefined || viewerOrg === undefined) return;

    if (viewer?.onboardingComplete) {
      router.replace("/");
      return;
    }

    const requestedBrokerFlow = searchParams?.get("type") === "broker";
    const orgType = (viewerOrg?.org as { type?: "broker" | "client" } | undefined)?.type;

    if (requestedBrokerFlow || orgType === "broker" || !viewerOrg?.org) {
      router.replace("/onboarding/broker");
      return;
    }

    router.replace("/onboarding/setup");
  }, [viewer, viewerOrg, router, searchParams]);

  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
