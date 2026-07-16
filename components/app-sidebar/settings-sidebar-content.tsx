"use client";

import { getSettingsNavigation } from "@/lib/settings-sections";
import { SectionHeader, SidebarMenuItem } from "./nav-item";
import { SidebarBrokerContact } from "./broker-contact-card";
import { SidebarHeader } from "./sidebar-header";
import type { BrokerContact } from "./types";

export function SettingsSidebarContent({
  collapsed,
  isBroker,
  isStandaloneClient,
  activeSettingsSection,
  broker,
  fallbackAgentHandle,
  showBrokerContact,
  onToggleCollapse,
}: {
  collapsed: boolean;
  isBroker: boolean;
  isStandaloneClient: boolean;
  activeSettingsSection: string;
  broker: BrokerContact;
  fallbackAgentHandle?: string;
  showBrokerContact: boolean;
  onToggleCollapse: () => void;
}) {
  const groups = getSettingsNavigation({ isBroker, isStandaloneClient });

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        collapsed={collapsed}
        headerOrgName=""
        initials=""
        onToggleCollapse={onToggleCollapse}
        backHref="/"
      />

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {groups.map((group) => (
          <div key={group.label}>
            <SectionHeader label={group.label} collapsed={collapsed} />
            {group.pages.map((item) => (
              <SidebarMenuItem
                key={item.id}
                href={`/settings?section=${item.id}&tab=${item.tabs[0].id}`}
                label={item.label}
                icon={item.icon}
                active={item.id === activeSettingsSection}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>

      {showBrokerContact && !collapsed ? (
        <SidebarBrokerContact
          broker={broker}
          fallbackAgentHandle={fallbackAgentHandle}
        />
      ) : null}
    </div>
  );
}
