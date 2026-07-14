import {
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

export type SettingsPageId =
  | "organization"
  | "team"
  | "agent"
  | "workflows"
  | "integrations"
  | "mailboxes"
  | "beta";

export type SettingsTabId =
  | "overview"
  | "broker"
  | "team"
  | "behavior"
  | "memory"
  | "models"
  | "delivery"
  | "certificates"
  | "notifications"
  | "mailboxes"
  | "mcp"
  | "cli"
  | "advanced"
  | "beta";

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
};

export type SettingsPage = {
  id: SettingsPageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  tabs: SettingsTab[];
};

export type SettingsNavGroup = {
  label: string;
  pages: SettingsPage[];
};

function GlassStarIcon({ className }: { className?: string }) {
  return createElement(LogoIcon, { size: 16, static: true, className });
}

export function getSettingsNavigation({
  isBroker,
  isStandaloneClient,
}: {
  isBroker: boolean;
  isStandaloneClient: boolean;
}): SettingsNavGroup[] {
  const pages: SettingsPage[] = [
    {
      id: "organization",
      label: "Organization",
      icon: Building2,
      tabs: [
        { id: "overview", label: "Overview" },
        ...(!isBroker ? [{ id: "broker" as const, label: "Broker" }] : []),
      ],
    },
    {
      id: "team",
      label: "Team",
      icon: Users,
      tabs: [{ id: "team", label: "Team" }],
    },
    {
      id: "agent",
      label: "Agent",
      icon: GlassStarIcon,
      tabs: [
        ...(isBroker || isStandaloneClient
          ? [{ id: "behavior" as const, label: "Behavior" }]
          : []),
        ...(!isBroker ? [{ id: "memory" as const, label: "Memory" }] : []),
        ...(isBroker ? [{ id: "models" as const, label: "Models" }] : []),
      ],
    },
    {
      id: "workflows",
      label: "Workflows",
      icon: isBroker ? Send : FileBadge2,
      tabs: [
        ...(isBroker ? [{ id: "delivery" as const, label: "Delivery" }] : []),
        { id: "certificates", label: "Certificates" },
        { id: "notifications", label: "Notifications" },
      ],
    },
    {
      id: "integrations",
      label: "Integrations",
      icon: Network,
      tabs: [
        { id: "mcp", label: "MCP" },
        { id: "cli", label: "CLI" },
        { id: "advanced", label: "Advanced" },
      ],
    },
    {
      id: "mailboxes",
      label: "Mailboxes",
      icon: Mail,
      tabs: [{ id: "mailboxes", label: "Mailboxes" }],
    },
    {
      id: "beta",
      label: "Beta",
      icon: FlaskConical,
      tabs: [{ id: "beta", label: "Beta" }],
    },
  ];

  const page = (id: SettingsPageId) => pages.find((item) => item.id === id)!;
  return [
    { label: "Workspace", pages: [page("organization"), page("team")] },
    { label: "Glass", pages: [page("agent"), page("workflows")] },
    {
      label: "Connections",
      pages: [page("integrations"), page("mailboxes")],
    },
    { label: "Advanced", pages: [page("beta")] },
  ];
}

export function settingsPages(groups: SettingsNavGroup[]) {
  return groups.flatMap((group) => group.pages);
}

const LEGACY_DESTINATIONS: Record<string, { section: SettingsPageId; tab: SettingsTabId }> = {
  organization: { section: "organization", tab: "overview" },
  broker: { section: "organization", tab: "broker" },
  team: { section: "team", tab: "team" },
  agent: { section: "agent", tab: "behavior" },
  memory: { section: "agent", tab: "memory" },
  models: { section: "agent", tab: "models" },
  delivery: { section: "workflows", tab: "delivery" },
  certificates: { section: "workflows", tab: "certificates" },
  notifications: { section: "workflows", tab: "notifications" },
  email: { section: "mailboxes", tab: "mailboxes" },
  connections: { section: "integrations", tab: "mcp" },
  beta: { section: "beta", tab: "beta" },
};

export function resolveSettingsDestination({
  requestedSection,
  requestedTab,
  groups,
}: {
  requestedSection: string | null;
  requestedTab: string | null;
  groups: SettingsNavGroup[];
}) {
  const pages = settingsPages(groups);
  const requestedPage = pages.find((page) => page.id === requestedSection);
  const legacy = requestedSection ? LEGACY_DESTINATIONS[requestedSection] : undefined;
  const page = requestedPage ?? pages.find((item) => item.id === legacy?.section) ?? pages[0];
  const desiredTab = requestedPage ? requestedTab : legacy?.tab;
  const tab = page.tabs.find((item) => item.id === desiredTab) ?? page.tabs[0];
  return { section: page.id, tab: tab.id, page };
}
