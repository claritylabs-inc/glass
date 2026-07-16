"use client";

import Link from "next/link";
import { Mail, MessageCircle, MessageSquare, Pin } from "lucide-react";
import {
  CLIENT_DETAIL_NAV,
  CLIENT_LIST_NAV_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
  MENU_ITEM_INACTIVE_SUBTLE,
} from "./nav-config";
import { SidebarMenuItem } from "./nav-item";
import { SidebarHeader } from "./sidebar-header";
import type { ClientThreadItem } from "./types";
import { splitThreadConversations } from "@/lib/thread-display";

export function ClientDetailSidebarContent({
  collapsed,
  clientDetailBase,
  clientDetailId,
  pathname,
  headerOrgIcon,
  viewerImage,
  initials,
  headerOrgName,
  clientThreads,
  onToggleCollapse,
}: {
  collapsed: boolean;
  clientDetailBase: string;
  clientDetailId?: string;
  pathname: string;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  clientThreads?: ClientThreadItem[];
  onToggleCollapse: () => void;
}) {
  const { agentConversations, imessageConversations } =
    splitThreadConversations(clientThreads);

  function isClientNavActive(href: string) {
    const full = `${clientDetailBase}${href}`;
    if (href === "")
      return (
        pathname === clientDetailBase || pathname === `${clientDetailBase}/`
      );
    return pathname === full || pathname.startsWith(`${full}/`);
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
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {!collapsed && (
          <p className="text-label font-medium text-muted-foreground/50 px-3 pt-3 pb-1.5">
            Client
          </p>
        )}
        {collapsed && <div className="pt-4 pb-1" />}
        <SidebarMenuItem
          href={CLIENT_LIST_NAV_ITEM.href}
          label={CLIENT_LIST_NAV_ITEM.label}
          icon={CLIENT_LIST_NAV_ITEM.icon}
          active={false}
          collapsed={collapsed}
        />
        {CLIENT_DETAIL_NAV.map((item) => (
          <SidebarMenuItem
            key={item.href || "details"}
            href={`${clientDetailBase}${item.href}`}
            label={item.label}
            icon={item.icon}
            active={isClientNavActive(item.href)}
            collapsed={collapsed}
          />
        ))}

        {!collapsed && clientDetailId && (
          <>
            <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
              <span className="text-label font-medium text-muted-foreground/50">
                Threads
              </span>
            </div>
            {clientThreads === undefined && (
              <div className="min-h-7" aria-hidden="true" />
            )}
            {clientThreads && clientThreads.length === 0 && (
              <p className="px-3 py-1 text-label text-muted-foreground/40">
                No threads
              </p>
            )}
            {imessageConversations.map((item) => {
              const href = `/clients/${clientDetailId}/threads/${item.id}`;
              const isConvActive = pathname === href;
              return (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={href}
                  className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} text-base ${
                    isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  <Pin className="w-3 h-3 shrink-0 rotate-45 text-muted-foreground/35" />
                </Link>
              );
            })}
            {agentConversations.map((item) => {
              const href = `/clients/${clientDetailId}/threads/${item.id}`;
              const isConvActive = pathname === href;
              return (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={href}
                  className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} text-base ${
                    isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
                  }`}
                >
                  {item.kind === "email" ? (
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate flex-1">{item.label}</span>
                </Link>
              );
            })}
            <Link
              href={`/clients/${clientDetailId}/threads`}
              className={`mt-0.5 flex items-center gap-2 px-3 py-1 ${MENU_ITEM_BASE} text-label ${MENU_ITEM_INACTIVE_SUBTLE}`}
            >
              <MessageSquare className="w-3 h-3 shrink-0" />
              <span>All threads</span>
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
