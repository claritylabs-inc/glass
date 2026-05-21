"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOrg } from "@/hooks/use-current-org";

export default function RootPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const targetHref = !currentOrg
    ? null
    : currentOrg.isPartner
      ? "/partner/approvals"
      : currentOrg.isBroker
        ? "/clients"
        : "/policies";

  useEffect(() => {
    if (!targetHref) return;
    router.replace(targetHref);
  }, [router, targetHref]);

  return null;
}
