"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  Activity,
  Building2,
  LogOut,
  MessageSquareText,
  Route,
  Radio,
  User,
  Users,
} from "lucide-react";
import {
  SectionHeader,
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { LogoIcon } from "@/components/ui/logo-icon";

export function OperatorSidebar({
  collapsed,
  onToggleCollapse,
  active,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active:
    | "brokers"
    | "clients"
    | "demo-leads"
    | "channels"
    | "routing"
    | "extractions"
    | "profile";
}) {
  const { signOut } = useAuthActions();

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
            href="/operator/extractions"
            label="Extractions"
            icon={Activity}
            active={active === "extractions"}
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
