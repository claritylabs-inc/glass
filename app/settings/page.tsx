"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, createContext, useContext } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Mail,
  Sparkles,
  Building2,
  Users,
  Key,
  FileText,
  Puzzle,
  CreditCard,
} from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentOrg } from "@/hooks/use-current-org";

/** Wrapper so LogoIcon matches the lucide icon interface used in nav items */
function PrismStarIcon({ className }: { className?: string }) {
  return <LogoIcon size={16} static className={className} />;
}
import { OrganizationSection } from "@/components/settings/organization-section";
import { TeamSection } from "@/components/settings/team-section";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { EmailConnectionsSection } from "@/components/settings/email-connections-section";
import { DocumentsSection } from "@/components/settings/documents-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { IntelligenceSection } from "@/components/settings/intelligence-section";
import { AgentSection } from "@/components/settings/agent-section";
import { BrokerBrandingTab } from "@/components/settings/broker-branding-tab";
import { BrokerTeamTab } from "@/components/settings/broker-team-tab";
import { BrokerAgentTab } from "@/components/settings/broker-agent-tab";
import { BrokerBillingPlaceholder } from "@/components/settings/broker-billing-placeholder";
import NotificationPreferencesPage from "./notifications/page";
import { Bell } from "lucide-react";

const CLIENT_SETTINGS_SECTIONS = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "email-connections", label: "Email Connections", icon: Mail },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  { id: "agent", label: "Agent", icon: PrismStarIcon },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const BROKER_SETTINGS_SECTIONS = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "branding", label: "Branding", icon: Sparkles },
  { id: "team", label: "Team", icon: Users },
  { id: "agent", label: "Agent", icon: PrismStarIcon },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

type ClientSection = (typeof CLIENT_SETTINGS_SECTIONS)[number]["id"];
type BrokerSection = (typeof BROKER_SETTINGS_SECTIONS)[number]["id"];
type SettingsSection = ClientSection | BrokerSection;

// Keep for backwards-compatible export
export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;

// ── Context for sections to inject header actions ──
export const SettingsActionsContext = createContext<{
  setActions: (node: React.ReactNode) => void;
}>({ setActions: () => {} });

export function useSettingsActions() {
  return useContext(SettingsActionsContext);
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
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
    <SettingsActionsContext.Provider value={{ setActions: setHeaderActions }}>
      <AppShell breadcrumbDetail={activeLabel} actions={headerActions}>
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
        {section === "organization" ? <OrganizationSection /> :
         section === "branding" ? <BrokerBrandingTab /> :
         section === "team" ? <BrokerTeamTab /> :
         section === "agent" ? <BrokerAgentTab /> :
         section === "billing" ? <BrokerBillingPlaceholder /> :
         section === "notifications" && currentOrg?.orgId ? (
           <NotificationPreferencesPage orgId={currentOrg.orgId} />
         ) : null}
      </div>
    );
  }
  return (
    <div>
      {section === "organization" ? (
        <OrganizationSection />
      ) : section === "team" ? (
        <TeamSection />
      ) : section === "api-keys" ? (
        <ApiKeysSection />
      ) : section === "email-connections" ? (
        <EmailConnectionsSection />
      ) : section === "documents" ? (
        <DocumentsSection />
      ) : section === "integrations" ? (
        <IntegrationsSection />
      ) : section === "intelligence" ? (
        <IntelligenceSection />
      ) : section === "agent" ? (
        <AgentSection />
      ) : section === "notifications" && currentOrg?.orgId ? (
        <NotificationPreferencesPage orgId={currentOrg.orgId} />
      ) : null}
    </div>
  );
}
