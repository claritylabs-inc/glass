"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";
import {
  getSettingsNavigation,
  resolveSettingsDestination,
  settingsPages,
  type SettingsPageId,
  type SettingsTabId,
} from "@/lib/settings-sections";
import { OrganizationSection } from "@/components/settings/organization-section";
import { TeamSection } from "@/components/settings/team-section";
import { EmailConnectionsSection } from "@/components/settings/email-connections-section";
import { ConnectionsSection } from "@/components/settings/connections-section";
import { MemorySection } from "@/components/settings/memory-section";
import { BrokerTeamTab } from "@/components/settings/broker-team-tab";
import { BrokerAgentTab } from "@/components/settings/broker-agent-tab";
import { ModelsSection } from "@/components/settings/models-section";
import { PolicyDeliverySection } from "@/components/settings/policy-delivery-section";
import { CertificateWorkflowSection } from "@/components/settings/certificate-workflow-section";
import { BrokerIdentitySection } from "@/components/settings/broker-identity-section";
import { BetaFeaturesSection } from "@/components/settings/beta-features-section";
import { NotificationPreferencesSection } from "@/components/settings/notification-preferences-section";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isStandaloneClient =
    currentOrg?.orgType === "client" && !currentOrg?.brokerOrg;
  const groups = useMemo(
    () => getSettingsNavigation({ isBroker, isStandaloneClient }),
    [isBroker, isStandaloneClient],
  );
  const pages = useMemo(() => settingsPages(groups), [groups]);
  const destination = resolveSettingsDestination({
    requestedSection: searchParams.get("section"),
    requestedTab: searchParams.get("tab"),
    groups,
  });

  useEffect(() => {
    if (!currentOrg) return;
    if (
      searchParams.get("section") === destination.section &&
      searchParams.get("tab") === destination.tab
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", destination.section);
    params.set("tab", destination.tab);
    router.replace(`/settings?${params.toString()}`);
  }, [currentOrg, destination.section, destination.tab, router, searchParams]);

  function navigate(section: SettingsPageId, tab: SettingsTabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", section);
    params.set("tab", tab);
    router.push(`/settings?${params.toString()}`);
  }

  function handlePageChange(section: SettingsPageId) {
    const page = pages.find((item) => item.id === section);
    if (page) navigate(page.id, page.tabs[0].id);
  }

  return (
    <SettingsActionsContext.Provider
      value={{ setActions: setHeaderActions, setRightPanel }}
    >
      <AppShell
        breadcrumbDetail={destination.page.label}
        actions={headerActions}
        rightPanel={rightPanel}
      >
        <div className="-mx-6 mb-6 overflow-x-auto px-6 scrollbar-hide lg:hidden">
          <Tabs
            value={destination.section}
            onValueChange={(value) => handlePageChange(value as SettingsPageId)}
          >
            <TabsList variant="pill" className="min-w-max">
              {pages.map((page) => {
                const Icon = page.icon;
                return (
                  <TabsTrigger key={page.id} value={page.id}>
                    <Icon className="size-3.5 shrink-0" />
                    {page.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {destination.page.tabs.length > 1 ? (
          <Tabs
            value={destination.tab}
            onValueChange={(value) =>
              navigate(destination.section, value as SettingsTabId)
            }
            className="mb-6"
          >
            <TabsList variant="pill">
              {destination.page.tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        <SectionContent
          section={destination.section}
          tab={destination.tab}
          isBroker={isBroker}
        />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}

function SectionContent({
  section,
  tab,
  isBroker,
}: {
  section: SettingsPageId;
  tab: SettingsTabId;
  isBroker: boolean;
}) {
  const currentOrg = useCurrentOrg();

  if (section === "organization") {
    if (tab === "broker" && currentOrg?.orgId) {
      return <BrokerIdentitySection orgId={currentOrg.orgId} />;
    }
    return <OrganizationSection />;
  }
  if (section === "team") {
    return isBroker ? <BrokerTeamTab /> : <TeamSection />;
  }
  if (section === "agent") {
    if (tab === "memory") return <MemorySection />;
    if (tab === "models") return <ModelsSection />;
    return <BrokerAgentTab />;
  }
  if (section === "workflows") {
    if (tab === "delivery") return <PolicyDeliverySection />;
    if (tab === "notifications" && currentOrg?.orgId) {
      return (
        <NotificationPreferencesSection
          orgId={currentOrg.orgId}
          orgType={isBroker ? "broker" : "client"}
        />
      );
    }
    return <CertificateWorkflowSection />;
  }
  if (section === "integrations") return <ConnectionsSection tab={tab} />;
  if (section === "mailboxes") return <EmailConnectionsSection />;
  return <BetaFeaturesSection />;
}
