"use client";

import Link from "next/link";
import {
  useSyncExternalStore,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
  SIDEBAR_TOOLTIP_CLASS,
  SIDEBAR_TOOLTIP_DELAY_MS,
  SIDEBAR_TOOLTIP_SIDE_OFFSET,
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

type SidebarMenuItemProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  shortcut?: NavShortcut;
  trailing?: ReactNode;
  className?: string;
  ariaPressed?: boolean;
} & (
  | {
      href: string;
      onClick?: never;
    }
  | {
      href?: never;
      onClick: MouseEventHandler<HTMLButtonElement>;
    }
);

export function SidebarTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={SIDEBAR_TOOLTIP_DELAY_MS}>
      {children}
    </TooltipProvider>
  );
}

export function SidebarMenuItem({
  href,
  onClick,
  label,
  icon: Icon,
  active,
  collapsed,
  shortcut,
  trailing,
  className = "",
  ariaPressed,
}: SidebarMenuItemProps) {
  const itemClassName = `flex w-full items-center gap-2.5 px-3 py-1.5 ${MENU_ITEM_BASE} text-base ${
    collapsed ? "justify-center" : ""
  } ${active ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE} ${className}`;
  const contents = (
    <>
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {trailing}
    </>
  );
  const item = href !== undefined ? (
    <Link
      href={href}
      id={shortcut ? stableSidebarTooltipId(href) : undefined}
      className={itemClassName}
      aria-label={collapsed ? label : undefined}
    >
      {contents}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      id={shortcut ? stableSidebarTooltipId(label) : undefined}
      className={itemClassName}
      aria-label={collapsed ? label : undefined}
      aria-pressed={ariaPressed}
    >
      {contents}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent
        side="right"
        align="center"
        sideOffset={SIDEBAR_TOOLTIP_SIDE_OFFSET}
        className={SIDEBAR_TOOLTIP_CLASS}
      >
        {shortcut ? (
          <ShortcutTooltipContent label={label} shortcut={shortcut} />
        ) : (
          <span className="text-label">{label}</span>
        )}
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
  const platformModifier = useSyncExternalStore(
    () => () => {},
    () => platformModifierForUserAgent(navigator.userAgent),
    () => "⌘",
  );

  if (shortcut.type === "command") {
    return (
      <>
        <span className="text-label">{label}</span>
        <span className="ml-1 inline-flex items-center gap-1 text-label leading-none text-muted-foreground">
          <ShortcutKeycap>{platformModifier}</ShortcutKeycap>
          <ShortcutKeycap>{shortcut.key.toUpperCase()}</ShortcutKeycap>
        </span>
      </>
    );
  }

  return (
    <>
      <span className="text-label">Go to {label}</span>
      <span className="ml-1 inline-flex items-center gap-1 text-label leading-none text-muted-foreground">
        <ShortcutKeycap>G</ShortcutKeycap>
        <span>then</span>
        <ShortcutKeycap>{shortcut.key.toUpperCase()}</ShortcutKeycap>
      </span>
    </>
  );
}

export function platformModifierForUserAgent(userAgent: string) {
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(userAgent)
    ? "⌘"
    : "Ctrl";
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
