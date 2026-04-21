import {
  Mail,
  Sparkles,
  Building2,
  Users,
  Key,
  FileText,
  Puzzle,
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
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "email-connections", label: "Email Connections", icon: Mail },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  // "agent" section is appended by consumers that have access to GlassStarIcon
];
