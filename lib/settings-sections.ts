import {
  Mail,
  Sparkles,
  Building2,
  Users,
  FileText,
  Puzzle,
  Network,
} from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

// The "agent" section uses GlassStarIcon (LogoIcon wrapper) defined in settings page.
// This shared list covers all sections; consumers that need the agent icon should
// override it or use the SETTINGS_SECTIONS_WITH_AGENT helper in the settings page.
export const CLIENT_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "connections", label: "Connections", icon: Network },
  { id: "email-connections", label: "Email Connections", icon: Mail },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  // "agent" section is appended by consumers that have access to GlassStarIcon
];

export const BROKER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  // "agent" section is appended by consumers that have access to GlassStarIcon
  { id: "connections", label: "Connections", icon: Network },
];

// Backwards-compatible export (client list).
export const SETTINGS_SECTIONS = CLIENT_SETTINGS_SECTIONS;
