import { Building2, Users, Puzzle, Network } from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const CLIENT_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "connections", label: "Connections", icon: Network },
  { id: "integrations", label: "Integrations", icon: Puzzle },
];

export const BROKER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "connections", label: "Connections", icon: Network },
];

export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;
