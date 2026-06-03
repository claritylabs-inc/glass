"use client";

import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
  SHORTCUT_TOOLTIP_CLASS,
  SHORTCUT_TOOLTIP_DELAY_MS,
  SHORTCUT_TOOLTIP_SIDE_OFFSET,
} from "./nav-config";
import type { NavShortcut } from "./types";

export function stableSidebarTooltipId(value: string) {
  return `sidebar-tooltip-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function SectionHeader({
  label,
  collapsed,
}: {
  label: string;
  collapsed: boolean;
}) {
  if (collapsed) return <div className="pt-4 pb-1" />;
  return (
    <p className="text-label font-medium text-muted-foreground/50  px-3 pt-5 pb-1.5">
      {label}
    </p>
  );
}

export function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  shortcut,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  shortcut?: NavShortcut;
}) {
  const link = (
    <Link
      href={href}
      id={shortcut ? stableSidebarTooltipId(href) : undefined}
      className={`flex items-center gap-2.5 px-3 py-1.5 ${MENU_ITEM_BASE} text-base ${
        collapsed ? "justify-center" : ""
      } ${active ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE}`}
      aria-label={collapsed ? label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="flex-1">{label}</span>}
    </Link>
  );

  if (!shortcut) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} delay={SHORTCUT_TOOLTIP_DELAY_MS} />
      <TooltipContent
        side="right"
        align="center"
        sideOffset={SHORTCUT_TOOLTIP_SIDE_OFFSET}
        className={SHORTCUT_TOOLTIP_CLASS}
      >
        <ShortcutTooltipContent label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ShortcutTooltipContent({
  label,
  shortcut,
}: {
  label: string;
  shortcut: NavShortcut;
}) {
  return (
    <>
      <span>Go to {label}</span>
      <span className="ml-1 inline-flex items-center gap-1 text-label leading-none text-muted-foreground">
        <ShortcutKeycap>G</ShortcutKeycap>
        <span>then</span>
        <ShortcutKeycap>{shortcut.key.toUpperCase()}</ShortcutKeycap>
      </span>
    </>
  );
}

function ShortcutKeycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      data-slot="kbd"
      className="border border-foreground/10 bg-foreground/4 px-1.5 py-0.5 font-mono text-label leading-none text-muted-foreground"
    >
      {children}
    </kbd>
  );
}
