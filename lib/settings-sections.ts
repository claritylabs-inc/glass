import {
  Bell,
  Brain,
  Briefcase,
  Building2,
  FileBadge2,
  FlaskConical,
  Mail,
  Network,
  Send,
  Users,
} from "lucide-react";
import { createElement, type ComponentType } from "react";
import { LogoIcon } from "@/components/ui/logo-icon";

export type SettingsSectionId =
  | "organization"
  | "broker"
  | "team"
  | "agent"
  | "memory"
  | "beta"
  | "models"
  | "delivery"
  | "certificates"
  | "email"
  | "connections"
  | "notifications";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const CLIENT_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "beta", label: "Beta Features", icon: FlaskConical },
  { id: "broker", label: "Broker", icon: Briefcase },
  { id: "team", label: "Team", icon: Users },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "connections", label: "Connections", icon: Network },
  { id: "certificates", label: "Certificates", icon: FileBadge2 },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export const BROKER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "models", label: "Models", icon: Brain },
  { id: "delivery", label: "Delivery", icon: Send },
  { id: "certificates", label: "Certificates", icon: FileBadge2 },
  { id: "email", label: "Email", icon: Mail },
  { id: "connections", label: "Connections", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;

function GlassStarIcon({ className }: { className?: string }) {
  return createElement(LogoIcon, { size: 16, static: true, className });
}

export const AGENT_SETTINGS_SECTION: SettingsSection = {
  id: "agent",
  label: "Agent",
  icon: GlassStarIcon,
};

export function insertSettingsSectionAfterTeam(
  sections: SettingsSection[],
  sectionToInsert: SettingsSection,
): SettingsSection[] {
  const teamIndex = sections.findIndex((section) => section.id === "team");
  if (teamIndex === -1) return [sectionToInsert, ...sections];
  return [
    ...sections.slice(0, teamIndex + 1),
    sectionToInsert,
    ...sections.slice(teamIndex + 1),
  ];
}

export const CLIENT_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  CLIENT_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);

export const BROKER_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  BROKER_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);

export function getSettingsSections({
  isBroker,
  isStandaloneClient,
}: {
  isBroker: boolean;
  isStandaloneClient: boolean;
}): SettingsSection[] {
  if (isBroker) return BROKER_SETTINGS_WITH_AGENT;
  if (isStandaloneClient) return CLIENT_SETTINGS_WITH_AGENT;
  return CLIENT_SETTINGS_SECTIONS;
}
