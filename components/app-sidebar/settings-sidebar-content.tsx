"use client";

import { getSettingsSections } from "@/lib/settings-sections";
import { NavItem } from "./nav-item";
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
  const sections = getSettingsSections({ isBroker, isStandaloneClient });

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        collapsed={collapsed}
        headerOrgName=""
        initials=""
        onToggleCollapse={onToggleCollapse}
        backHref="/"
      />

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {!collapsed && (
          <p className="text-label font-medium text-muted-foreground/50 px-3 pt-3 pb-1.5">
            Settings
          </p>
        )}
        {collapsed && <div className="pt-4 pb-1" />}
        {sections.map((item) => {
          const isItemActive = item.id === activeSettingsSection;
          return (
            <NavItem
              key={item.id}
              href={`/settings?section=${item.id}`}
              label={item.label}
              icon={item.icon}
              active={isItemActive}
              collapsed={collapsed}
            />
          );
        })}
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
