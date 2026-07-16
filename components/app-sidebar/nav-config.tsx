import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Building2,
  ClipboardCheck,
  FileText,
  Send,
  Settings,
  User,
  Users,
} from "lucide-react";
import { getPublicAgentDomain } from "@/lib/domains";
import type { NavItemConfig, NavShortcut } from "./types";

export const AGENT_DOMAIN = getPublicAgentDomain();

export const MENU_ITEM_BASE =
  "cursor-pointer rounded-md transition-[background-color,color,box-shadow] duration-100 ease-out";
export const MENU_ITEM_HOVER =
  "hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/10";
export const MENU_ITEM_ACTIVE =
  "bg-foreground/6 text-foreground hover:bg-foreground/10! dark:bg-foreground/10 dark:hover:bg-foreground/20!";
export const MENU_ITEM_INACTIVE = `text-muted-foreground ${MENU_ITEM_HOVER}`;
export const MENU_ITEM_INACTIVE_SUBTLE =
  "text-muted-foreground/40 hover:bg-foreground/5 hover:text-muted-foreground/65 dark:hover:bg-foreground/10 dark:hover:text-muted-foreground/80";

export const SHORTCUT_PREFIX_KEY = "g";
export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1500;
export const SIDEBAR_TOOLTIP_DELAY_MS = 500;
export const SIDEBAR_TOOLTIP_SIDE_OFFSET = 4;
export const SIDEBAR_TOOLTIP_CLASS =
  "border border-foreground/10 bg-background text-label text-foreground data-instant:animate-none has-data-[slot=kbd]:pr-2.5 [&_[class*='size-2.5']]:hidden";

export function navShortcut(key: string): NavShortcut {
  return { key };
}

export function commandShortcut(key: string): NavShortcut {
  return { key, type: "command" };
}

export const INSURANCE_ITEMS: NavItemConfig[] = [
  {
    href: "/policies",
    label: "Policies",
    icon: FileText,
    shortcut: navShortcut("p"),
  },
  {
    href: "/certificates",
    label: "Certificates",
    icon: BadgeCheck,
    shortcut: navShortcut("e"),
  },
  {
    href: "/compliance",
    label: "Compliance",
    icon: ClipboardCheck,
    shortcut: navShortcut("r"),
  },
];

export const CONNECT_ITEMS: NavItemConfig[] = [
  {
    href: "/connect/clients",
    label: "Clients",
    icon: Users,
    shortcut: navShortcut("l"),
  },
  {
    href: "/connect/vendors",
    label: "Vendors",
    icon: Building2,
    shortcut: navShortcut("v"),
  },
];
export const NO_CONNECT_ITEMS: NavItemConfig[] = [];

export const ALL_NAV_ITEMS = [...INSURANCE_ITEMS];

export const BROKER_NAV_ITEMS: NavItemConfig[] = [
  {
    href: "/clients",
    label: "Clients",
    icon: Users,
    shortcut: navShortcut("c"),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: Activity,
    shortcut: navShortcut("a"),
  },
  {
    href: "/deliveries",
    label: "Deliveries",
    icon: Send,
    shortcut: navShortcut("d"),
  },
];

export const CLIENT_DETAIL_NAV: NavItemConfig[] = [
  { href: "", label: "Details", icon: User },
  { href: "/policies", label: "Policies", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const CLIENT_LIST_NAV_ITEM: NavItemConfig = {
  href: "/clients",
  label: "Clients",
  icon: ArrowLeft,
};
