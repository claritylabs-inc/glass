"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Mail,
  Sparkles,
  Activity,
  Bot,
  Building2,
  Users,
  Key,
} from "lucide-react";
import { OrganizationSection } from "@/components/settings/organization-section";
import { TeamSection } from "@/components/settings/team-section";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { SourcesSection } from "@/components/settings/sources-section";

const SETTINGS_SECTIONS = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "sources", label: "Sources", icon: Mail },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "agent", label: "Agent", icon: Bot },
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
    <AppShell>
      {/* Mobile: horizontal scrollable tabs */}
      <div className="lg:hidden mb-6 -mx-1 overflow-x-auto">
        <div className="flex gap-1 px-1 min-w-max">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === activeSection;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => handleSectionChange(section.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-body-sm whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? "bg-foreground/5 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                }`}
              >
                <Icon size={16} />
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: sidebar + content */}
      <div className="hidden lg:flex gap-8">
        {/* Sidebar nav */}
        <nav className="w-[200px] shrink-0">
          <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
            Settings
          </p>
          <ul className="space-y-0.5">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => handleSectionChange(section.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-body-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-foreground/5 text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                    }`}
                  >
                    <Icon size={16} />
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          <SectionContent section={activeSection} sectionLabel={activeLabel} />
        </div>
      </div>

      {/* Mobile: section content below tabs */}
      <div className="lg:hidden">
        <SectionContent section={activeSection} sectionLabel={activeLabel} />
      </div>
    </AppShell>
  );
}

function SectionContent({
  section,
  sectionLabel,
}: {
  section: SettingsSection;
  sectionLabel: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">{sectionLabel}</h2>
      {section === "organization" ? (
        <OrganizationSection />
      ) : section === "team" ? (
        <TeamSection />
      ) : section === "api-keys" ? (
        <ApiKeysSection />
      ) : section === "sources" ? (
        <SourcesSection />
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-8 text-center">
          <p className="text-body-sm text-muted-foreground">
            Section: <span className="font-medium text-foreground">{section}</span>
          </p>
          <p className="text-label-sm text-muted-foreground/50 mt-1">
            Content will be migrated here in a future task.
          </p>
        </div>
      )}
    </div>
  );
}
