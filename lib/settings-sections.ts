import { Building2, Users, Puzzle, Network, Brain, UserCircle } from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const CLIENT_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "connections", label: "Connections", icon: Network },
  { id: "integrations", label: "Integrations", icon: Puzzle },
];

export const PARTNER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "models", label: "Models", icon: Brain },
  { id: "connections", label: "Connections", icon: Network },
];

export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;
