"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, createContext, useContext } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Building2,
  Users,
  Puzzle,
  Network,
  Brain,
} from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentOrg } from "@/hooks/use-current-org";

/** Wrapper so LogoIcon matches the lucide icon interface used in nav items */
function GlassStarIcon({ className }: { className?: string }) {
  return <LogoIcon size={16} static className={className} />;
}
import { OrganizationSection } from "@/components/settings/organization-section";
import { TeamSection } from "@/components/settings/team-section";
import { ConnectionsSection } from "@/components/settings/connections-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { MemorySection } from "@/components/settings/memory-section";
import { BrokerTeamTab } from "@/components/settings/broker-team-tab";
import { BrokerAgentTab } from "@/components/settings/broker-agent-tab";
import { ModelsSection } from "@/components/settings/models-section";
import { ProfileSection } from "@/components/settings/profile-section";
import NotificationPreferencesPage from "./notifications/page";
import { Bell } from "lucide-react";

const CLIENT_SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: Users },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "connections", label: "Connections", icon: Network },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const BROKER_SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: Users },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "agent", label: "Agent", icon: GlassStarIcon },
  { id: "models", label: "Models", icon: Brain },
  { id: "connections", label: "Connections", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

type ClientSection = (typeof CLIENT_SETTINGS_SECTIONS)[number]["id"];
type BrokerSection = (typeof BROKER_SETTINGS_SECTIONS)[number]["id"];
type SettingsSection = ClientSection | BrokerSection;

// Keep for backwards-compatible export
export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;

// ── Context for sections to inject header actions and a right-side drawer panel ──
export const SettingsActionsContext = createContext<{
  setActions: (node: React.ReactNode) => void;
  setRightPanel: (node: React.ReactNode) => void;
}>({ setActions: () => {}, setRightPanel: () => {} });

export function useSettingsActions() {
  return useContext(SettingsActionsContext);
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;

  const SETTINGS_SECTIONS_ACTIVE = isBroker ? BROKER_SETTINGS_SECTIONS : CLIENT_SETTINGS_SECTIONS;

  const activeSection = (searchParams.get("section") as SettingsSection) ?? "organization";

  function handleSectionChange(id: SettingsSection) {
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
            onValueChange={(value) => handleSectionChange(value as SettingsSection)}
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
        <SectionContent section={activeSection} isBroker={isBroker} />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}

function SectionContent({ section, isBroker }: { section: SettingsSection; isBroker: boolean }) {
  const currentOrg = useCurrentOrg();

  if (isBroker) {
    return (
      <div>
        {section === "profile" ? <ProfileSection /> :
         section === "organization" ? <OrganizationSection /> :
         section === "team" ? <BrokerTeamTab /> :
         section === "agent" ? <BrokerAgentTab /> :
         section === "models" ? <ModelsSection /> :
         section === "connections" ? <ConnectionsSection /> :
         section === "notifications" && currentOrg?.orgId ? (
           <NotificationPreferencesPage orgId={currentOrg.orgId} />
         ) : null}
      </div>
    );
  }
  return (
    <div>
      {section === "profile" ? (
        <ProfileSection />
      ) : section === "organization" ? (
        <OrganizationSection />
      ) : section === "team" ? (
        <TeamSection />
      ) : section === "memory" ? (
        <MemorySection />
      ) : section === "connections" ? (
        <ConnectionsSection />
      ) : section === "integrations" ? (
        <IntegrationsSection />
      ) : section === "notifications" && currentOrg?.orgId ? (
        <NotificationPreferencesPage orgId={currentOrg.orgId} />
      ) : null}
    </div>
  );
}
