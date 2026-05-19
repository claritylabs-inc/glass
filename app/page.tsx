"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOrg } from "@/hooks/use-current-org";

export default function RootPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();

  useEffect(() => {
    if (!currentOrg) return; // still loading
    if (currentOrg.isPartner) {
      router.replace("/partner/approvals");
    } else if (currentOrg.isBroker) {
      router.replace("/clients");
    } else {
      router.replace("/policies");
    }
  }, [currentOrg, router]);

  return null;
}
