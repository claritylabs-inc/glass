"use client";

import Link from "next/link";
import {
  Archive,
  Bell,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  User,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_HOVER,
  MENU_ITEM_INACTIVE,
  MENU_ITEM_INACTIVE_SUBTLE,
  navShortcut,
  SHORTCUT_TOOLTIP_CLASS,
  SHORTCUT_TOOLTIP_DELAY_MS,
  SHORTCUT_TOOLTIP_SIDE_OFFSET,
} from "./nav-config";
import { NavItem, SectionHeader, ShortcutTooltipContent } from "./nav-item";
import { SidebarBrokerContact } from "./broker-contact-card";
import { SidebarHeader } from "./sidebar-header";
import type {
  BrokerContact,
  ConversationItem,
  MergeSuggestionPayload,
  NavItemConfig,
} from "./types";

function isImessageConversation(item: ConversationItem) {
  return item.kind === "imessage" || item.label.startsWith("iMessage");
}

export function MainSidebarContent({
  collapsed,
  isBroker,
  pathname,
  headerOrgIcon,
  viewerImage,
  initials,
  headerOrgName,
  navItems,
  connectItems,
  notificationsPanelOpen,
  unreadCount,
  isDesktop,
  orgId,
  conversations,
  archivedThreadCount,
  broker,
  fallbackAgentHandle,
  onToggleCollapse,
  onToggleNotifications,
  onCloseNotifications,
  onMergeSuggestion,
  onNewChat,
  onArchiveThread,
  onSignOut,
}: {
  collapsed: boolean;
  isBroker: boolean;
  pathname: string;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  navItems: NavItemConfig[];
  connectItems: NavItemConfig[];
  notificationsPanelOpen: boolean;
  unreadCount?: number;
  isDesktop: boolean;
  orgId?: Id<"organizations">;
  conversations: ConversationItem[];
  archivedThreadCount: number;
  broker: BrokerContact;
  fallbackAgentHandle?: string;
  onToggleCollapse: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  onMergeSuggestion: (payload: MergeSuggestionPayload) => void;
  onNewChat: () => void | Promise<void>;
  onArchiveThread: (threadId: string, active: boolean) => Promise<void>;
  onSignOut: () => void;
}) {
  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/agent") return pathname === "/agent";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        collapsed={collapsed}
        headerOrgIcon={headerOrgIcon}
        viewerImage={viewerImage}
        initials={initials}
        headerOrgName={headerOrgName}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="relative px-2 py-2 border-b border-foreground/6">
        <button
          type="button"
          onClick={onToggleNotifications}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 ${MENU_ITEM_BASE} text-body-sm ${
            collapsed ? "justify-center" : ""
          } ${notificationsPanelOpen ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE}`}
          title={collapsed ? "Notifications" : undefined}
        >
          {collapsed ? (
            <Bell className="w-4 h-4 shrink-0" />
          ) : (
            <>
              <Bell className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left">Notifications</span>
            </>
          )}
          {(unreadCount ?? 0) > 0 && (
            <span
              className={`flex items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-medium leading-none shrink-0 ${
                collapsed ? "w-4 h-4" : "min-w-4.5 h-4 px-1"
              }`}
            >
              {unreadCount! > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        {notificationsPanelOpen && !isDesktop && orgId && (
          <NotificationsPanel
            orgId={orgId}
            onClose={onCloseNotifications}
            onMergeSuggestion={onMergeSuggestion}
          />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        <SectionHeader
          label={isBroker ? "Partner" : "Insurance"}
          collapsed={collapsed}
        />
        {navItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut ?? undefined}
          />
        ))}

        <SectionHeader label="Connect" collapsed={collapsed} />
        {connectItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut ?? undefined}
          />
        ))}

        {isBroker ? null : !collapsed ? (
          <ExpandedThreadList
            conversations={conversations}
            archivedThreadCount={archivedThreadCount}
            pathname={pathname}
            onNewChat={onNewChat}
            onArchiveThread={onArchiveThread}
          />
        ) : (
          <CollapsedThreadList
            conversations={conversations}
            pathname={pathname}
            onNewChat={onNewChat}
          />
        )}
      </nav>

      {!isBroker && !collapsed ? (
        <SidebarBrokerContact
          broker={broker}
          fallbackAgentHandle={fallbackAgentHandle}
        />
      ) : null}

      <div className="border-t border-foreground/6 px-2 py-2 space-y-0.5">
        <NavItem
          href="/settings"
          label="Settings"
          icon={Settings}
          active={isActive("/settings")}
          collapsed={collapsed}
          shortcut={navShortcut("s")}
        />
        <NavItem
          href="/profile"
          label="Profile"
          icon={User}
          active={isActive("/profile")}
          collapsed={collapsed}
          shortcut={navShortcut("u")}
        />
        <button
          type="button"
          onClick={onSignOut}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 ${MENU_ITEM_BASE} text-body-sm ${MENU_ITEM_INACTIVE} ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </div>
  );
}

function ExpandedThreadList({
  conversations,
  archivedThreadCount,
  pathname,
  onNewChat,
  onArchiveThread,
}: {
  conversations: ConversationItem[];
  archivedThreadCount: number;
  pathname: string;
  onNewChat: () => void | Promise<void>;
  onArchiveThread: (threadId: string, active: boolean) => Promise<void>;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
        <span className="text-label-sm font-medium text-muted-foreground/50 ">
          Threads
        </span>
        {conversations.length > 0 && (
          <PillButton
            type="button"
            size="compact"
            variant="icon"
            onClick={onNewChat}
            title="New thread"
            aria-label="New thread"
          >
            <Plus className="w-3.5 h-3.5" />
          </PillButton>
        )}
      </div>
      {conversations.length === 0 && (
        <button
          type="button"
          onClick={onNewChat}
          className={`w-full flex items-center gap-2 px-3 py-1 ${MENU_ITEM_BASE} text-label-sm text-muted-foreground/60 ${MENU_ITEM_HOVER}`}
        >
          <Plus className="w-3 h-3 shrink-0" />
          <span>New chat</span>
        </button>
      )}
      {conversations.map((item, idx) => {
        const isConvActive = pathname === `/agent/thread/${item.id}`;
        const shortcut = idx < 9 ? navShortcut(String(idx + 1)) : undefined;
        const threadLink = (
          <Link
            href={`/agent/thread/${item.id}`}
            className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} text-body-sm ${
              isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
            }`}
          >
            {isImessageConversation(item) ? (
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
            ) : item.kind === "email" ? (
              <Mail className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate flex-1">{item.label}</span>
            <span className="relative h-5 w-5 shrink-0">
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  await onArchiveThread(item.id, isConvActive);
                }}
                className="absolute inset-0 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-all duration-150 hover:bg-foreground/6 hover:text-foreground group-hover:opacity-100"
                title="Archive"
              >
                <Archive className="w-3 h-3" />
              </button>
            </span>
          </Link>
        );

        if (!shortcut)
          return <div key={`${item.kind}-${item.id}`}>{threadLink}</div>;

        return (
          <Tooltip key={`${item.kind}-${item.id}`}>
            <TooltipTrigger
              render={threadLink}
              delay={SHORTCUT_TOOLTIP_DELAY_MS}
            />
            <TooltipContent
              side="right"
              align="center"
              sideOffset={SHORTCUT_TOOLTIP_SIDE_OFFSET}
              className={SHORTCUT_TOOLTIP_CLASS}
            >
              <ShortcutTooltipContent label="thread" shortcut={shortcut} />
            </TooltipContent>
          </Tooltip>
        );
      })}
      {archivedThreadCount > 0 && (
        <Link
          href="/agent/archive"
          className={`mt-0.5 flex items-center gap-2 px-3 py-1 ${MENU_ITEM_BASE} text-label-sm ${MENU_ITEM_INACTIVE_SUBTLE}`}
        >
          <Archive className="w-3 h-3 shrink-0" />
          <span>Archived</span>
        </Link>
      )}
    </>
  );
}

function CollapsedThreadList({
  conversations,
  pathname,
  onNewChat,
}: {
  conversations: ConversationItem[];
  pathname: string;
  onNewChat: () => void | Promise<void>;
}) {
  return (
    <>
      <div className="pt-4 pb-1" />
      {conversations.slice(0, 5).map((item) => {
        const isConvActive = pathname === `/agent/thread/${item.id}`;
        return (
          <Link
            key={`${item.kind}-${item.id}`}
            href={`/agent/thread/${item.id}`}
            title={item.label}
            className={`flex items-center justify-center py-1.5 ${MENU_ITEM_BASE} ${
              isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE_SUBTLE
            }`}
          >
            {isImessageConversation(item) ? (
              <MessageCircle className="w-3.5 h-3.5" />
            ) : item.kind === "email" ? (
              <Mail className="w-3.5 h-3.5" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
          </Link>
        );
      })}
      <div className="flex items-center justify-center mt-0.5">
        <PillButton
          type="button"
          size="compact"
          variant="icon"
          onClick={onNewChat}
          title="New thread"
          aria-label="New thread"
        >
          <Plus className="w-3.5 h-3.5" />
        </PillButton>
      </div>
    </>
  );
}
