"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LogoIcon } from "@/components/ui/logo-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";
import {
  BROKER_SETTINGS_SECTIONS,
  CLIENT_SETTINGS_SECTIONS,
  insertSettingsSectionAfterTeam,
  type SettingsSection,
  type SettingsSectionId,
} from "@/lib/settings-sections";

/** Wrapper so LogoIcon matches the lucide icon interface used in nav items */
function GlassStarIcon({ className }: { className?: string }) {
  return <LogoIcon size={16} static className={className} />;
}
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
import NotificationPreferencesPage from "./notifications/page";

const AGENT_SETTINGS_SECTION: SettingsSection = { id: "agent", label: "Agent", icon: GlassStarIcon };

const CLIENT_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  CLIENT_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);
const BROKER_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  BROKER_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isStandaloneClient = currentOrg?.orgType === "client" && !currentOrg?.brokerOrg;

  const SETTINGS_SECTIONS_ACTIVE = isBroker
    ? BROKER_SETTINGS_WITH_AGENT
    : isStandaloneClient
      ? CLIENT_SETTINGS_WITH_AGENT
      : CLIENT_SETTINGS_SECTIONS.filter((section) => section.id !== "agent");
  const requestedSection = searchParams.get("section") as SettingsSectionId | null;
  const activeSection: SettingsSectionId = SETTINGS_SECTIONS_ACTIVE.some((section) => section.id === requestedSection)
    ? requestedSection!
    : "organization";

  function handleSectionChange(id: SettingsSectionId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", id);
    router.push(`/settings?${params.toString()}`);
  }

  const activeLabel =
    SETTINGS_SECTIONS_ACTIVE.find((s) => s.id === activeSection)?.label ?? "Settings";

  return (
    <SettingsActionsContext.Provider value={{ setActions: setHeaderActions, setRightPanel }}>
      <AppShell
        breadcrumbDetail={activeLabel === "Settings" ? undefined : activeLabel}
        actions={headerActions}
        rightPanel={rightPanel}
      >
        {/* Mobile: horizontal scrollable tabs */}
        <div className="lg:hidden mb-6 -mx-6 px-6 overflow-x-auto scrollbar-hide">
          <Tabs
            value={activeSection}
            onValueChange={(value) => handleSectionChange(value as SettingsSectionId)}
          >
            <TabsList variant="pill" className="min-w-max">
              {SETTINGS_SECTIONS_ACTIVE.map((section) => {
                const Icon = section.icon;
                return (
                  <TabsTrigger key={section.id} value={section.id}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {section.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {/* Section content — sidebar navigation is handled by the main app sidebar on desktop */}
        <SectionContent
          section={activeSection}
          isBroker={isBroker}
          isStandaloneClient={isStandaloneClient}
        />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}

function SectionContent({
  section,
  isBroker,
  isStandaloneClient,
}: {
  section: SettingsSectionId;
  isBroker: boolean;
  isStandaloneClient: boolean;
}) {
  const currentOrg = useCurrentOrg();

  if (isBroker) {
    return (
      <div>
        {section === "organization" ? <OrganizationSection /> :
         section === "team" ? <BrokerTeamTab /> :
         section === "agent" ? <BrokerAgentTab /> :
         section === "models" ? <ModelsSection /> :
         section === "delivery" ? <PolicyDeliverySection /> :
         section === "certificates" ? <CertificateWorkflowSection /> :
         section === "email" ? <EmailConnectionsSection /> :
         section === "connections" ? <ConnectionsSection /> :
         section === "notifications" && currentOrg?.orgId ? (
           <NotificationPreferencesPage orgId={currentOrg.orgId} orgType="broker" />
         ) : null}
      </div>
    );
  }
  return (
    <div>
      {section === "organization" ? (
        <OrganizationSection />
      ) : section === "broker" && currentOrg?.orgId ? (
        <BrokerIdentitySection orgId={currentOrg.orgId} />
      ) : section === "team" ? (
        <TeamSection />
      ) : section === "agent" && isStandaloneClient ? (
        <BrokerAgentTab />
      ) : section === "memory" ? (
        <MemorySection />
      ) : section === "certificates" ? (
        <CertificateWorkflowSection />
      ) : section === "email" ? (
        <EmailConnectionsSection />
      ) : section === "connections" ? (
        <ConnectionsSection />
      ) : section === "notifications" && currentOrg?.orgId ? (
        <NotificationPreferencesPage orgId={currentOrg.orgId} orgType="client" />
      ) : null}
    </div>
  );
}
