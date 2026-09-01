"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import {
  Building2,
  List,
  LogOut,
  MessageSquareText,
  ScrollText,
  Route,
  Radio,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SectionHeader,
  SidebarHeaderLink,
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
} from "@/components/app-sidebar/nav-config";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { LogoIcon } from "@/components/ui/logo-icon";
import { OperatorThreadChannelIcon } from "@/components/operator-agent/operator-thread-channel";
import {
  normalizeOperatorAgentThreads,
  operatorAgentApi,
} from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";

export function OperatorSidebar({
  collapsed,
  onToggleCollapse,
  active,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active:
    | "threads"
    | "brokers"
    | "clients"
    | "demo-leads"
    | "channels"
    | "routing"
    | "telemetry"
    | "profile";
}) {
  const { signOut } = useAuthActions();
  const pathname = usePathname();
  const rawThreads = useQuery(operatorAgentApi.listThreads, { limit: 8 });
  const threads = normalizeOperatorAgentThreads(rawThreads);

  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Operator"
        onToggleCollapse={onToggleCollapse}
        icon={<LogoIcon size={15} static />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        {collapsed ? (
          <SidebarMenuItem
            href="/operator/threads"
            label="Threads"
            icon={List}
            active={active === "threads"}
            collapsed
          />
        ) : (
          <>
            <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
              <span
                className={`text-muted-foreground/50 ${typeStyle("caption.medium")}`}
              >
                Threads
              </span>
              <SidebarHeaderLink
                href="/operator/threads"
                label="All threads"
                icon={List}
                active={pathname === "/operator/threads"}
              />
            </div>
            {threads.map((thread) => {
              const href = `/operator/threads/${thread.id}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={thread.id}
                  href={href}
                  className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} ${typeStyle("control.button")} ${
                    isActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
                  }`}
                >
                  <OperatorThreadChannelIcon
                    channel={thread.channel}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title}
                  </span>
                </Link>
              );
            })}
          </>
        )}
        <SectionHeader label="Accounts" collapsed={collapsed} />
        <div className="flex flex-col gap-1">
          <SidebarMenuItem
            href="/operator"
            label="Clients"
            icon={Users}
            active={active === "clients"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/brokers"
            label="Brokers"
            icon={Building2}
            active={active === "brokers"}
            collapsed={collapsed}
          />
        </div>
        <SectionHeader label="Sales" collapsed={collapsed} />
        <div className="flex flex-col gap-1">
          <SidebarMenuItem
            href="/operator/demo-leads"
            label="Demo leads"
            icon={MessageSquareText}
            active={active === "demo-leads"}
            collapsed={collapsed}
          />
        </div>
        <SectionHeader label="DevOps" collapsed={collapsed} />
        <div className="flex flex-col gap-1">
          <SidebarMenuItem
            href="/operator/channels"
            label="Channels"
            icon={Radio}
            active={active === "channels"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/routing"
            label="Routing"
            icon={Route}
            active={active === "routing"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/telemetry"
            label="Telemetry"
            icon={ScrollText}
            active={active === "telemetry"}
            collapsed={collapsed}
          />
        </div>
      </div>
      <div className="space-y-0.5 border-t border-border px-2 py-2">
        <SidebarMenuItem
          href="/operator/profile"
          label="Profile"
          icon={User}
          active={active === "profile"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          onClick={() => void signOut()}
          label="Sign out"
          icon={LogOut}
          active={false}
          collapsed={collapsed}
        />
      </div>
    </SidebarTooltipProvider>
  );
}
