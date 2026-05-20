"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BrokerIdentitySection } from "@/components/settings/broker-identity-section";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function BrokerPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const brokerPageContext = useQuery(api.orgs.getBrokerPageContext, {});

  useEffect(() => {
    if (brokerPageContext && !brokerPageContext.showBrokerPage) {
      router.replace("/policies");
    }
  }, [brokerPageContext, router]);

  if (!currentOrg?.orgId || !brokerPageContext?.showBrokerPage) return null;

  return (
    <AppShell breadcrumbDetail="Broker">
      <BrokerIdentitySection orgId={currentOrg.orgId} />
    </AppShell>
  );
}
