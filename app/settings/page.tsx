"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Mail,
  Sparkles,
  Building2,
  Users,
  Key,
  FileText,
  Puzzle,
} from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";

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

const SETTINGS_SECTIONS = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "email-connections", label: "Email Connections", icon: Mail },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  { id: "agent", label: "Agent", icon: PrismStarIcon },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeSection = (searchParams.get("section") as SettingsSection) ?? "organization";

  function handleSectionChange(id: SettingsSection) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", id);
    router.push(`/settings?${params.toString()}`);
  }

  const activeLabel =
    SETTINGS_SECTIONS.find((s) => s.id === activeSection)?.label ?? "Settings";

  return (
    <AppShell breadcrumbDetail={activeLabel}>
      {/* Mobile: horizontal scrollable tabs */}
      <div className="lg:hidden mb-6 -mx-6 px-6 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 min-w-max">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === activeSection;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => handleSectionChange(section.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-label-sm whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? "bg-foreground/8 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: sidebar + content */}
      <div className="hidden lg:flex gap-0 -ml-8 -mt-6 -mb-24 min-h-[calc(100vh-4rem)]">
        {/* Sidebar nav — breaks out of container padding to align with edge */}
        <nav className="w-[200px] shrink-0 sticky top-0 self-start border-r border-foreground/6 py-4 pr-2 pl-4 min-h-[inherit]">
          <ul className="space-y-0.5">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => handleSectionChange(section.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-body-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-foreground/[0.05] text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left">{section.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Section content */}
        <div className="flex-1 min-w-0 pt-4 pl-8">
          <SectionContent section={activeSection} />
        </div>
      </div>

      {/* Mobile: section content below tabs */}
      <div className="lg:hidden">
        <SectionContent section={activeSection} />
      </div>
    </AppShell>
  );
}

function SectionContent({ section }: { section: SettingsSection }) {
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
      ) : null}
    </div>
  );
}
