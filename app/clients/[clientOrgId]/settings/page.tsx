"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { BrokerIdentitySection } from "@/components/settings/broker-identity-section";
import { ClientEmailRoutingSection } from "@/components/settings/client-email-routing-section";
import { PolicyDeliverySection } from "@/components/settings/policy-delivery-section";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClientDetailActions } from "../layout";

const CLIENT_SETTINGS_TABS = [
  { id: "broker", label: "Broker contact" },
  { id: "agent-email", label: "Agent email" },
  { id: "policy-delivery", label: "Policy delivery" },
] as const;

type ClientSettingsTab = (typeof CLIENT_SETTINGS_TABS)[number]["id"];

function parseClientSettingsTab(value: string | null): ClientSettingsTab {
  return CLIENT_SETTINGS_TABS.some((tab) => tab.id === value)
    ? (value as ClientSettingsTab)
    : "broker";
}

export default function ClientSettingsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setRightPanel, setBreadcrumbExtra } = useClientDetailActions();
  const activeTab = parseClientSettingsTab(searchParams.get("tab"));
  const orgId = clientOrgId as Id<"organizations">;

  useEffect(() => {
    setBreadcrumbExtra("Settings");
    return () => setBreadcrumbExtra(null);
  }, [setBreadcrumbExtra]);

  useEffect(() => {
    if (searchParams.get("tab") === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", activeTab);
    router.replace(`/clients/${clientOrgId}/settings?${params.toString()}`);
  }, [activeTab, clientOrgId, router, searchParams]);

  function navigate(tab: ClientSettingsTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/clients/${clientOrgId}/settings?${params.toString()}`);
  }

  return (
    <div className="w-full">
      <div className="-mx-1 mb-6 overflow-x-auto px-1 scrollbar-hide">
        <Tabs
          value={activeTab}
          onValueChange={(value) => navigate(value as ClientSettingsTab)}
        >
          <TabsList variant="pill" className="min-w-max">
            {CLIENT_SETTINGS_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "broker" ? <BrokerIdentitySection orgId={orgId} /> : null}
      {activeTab === "agent-email" ? (
        <ClientEmailRoutingSection clientOrgId={orgId} />
      ) : null}
      {activeTab === "policy-delivery" ? (
        <PolicyDeliverySection
          clientOrgId={orgId}
          setRightPanel={setRightPanel}
        />
      ) : null}
    </div>
  );
}
