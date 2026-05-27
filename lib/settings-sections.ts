import { Bell, Brain, Building2, Mail, Network, Send, Users } from "lucide-react";
import type { ComponentType } from "react";

export type SettingsSectionId =
  | "organization"
  | "team"
  | "agent"
  | "memory"
  | "models"
  | "delivery"
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
  { id: "team", label: "Team", icon: Users },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "connections", label: "Connections", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export const BROKER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "models", label: "Models", icon: Brain },
  { id: "delivery", label: "Delivery", icon: Send },
  { id: "email", label: "Email", icon: Mail },
  { id: "connections", label: "Connections", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export const PARTNER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
];
export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;

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
