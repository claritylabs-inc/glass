"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Activity, Building2, LogOut, MessageSquareText, SlidersHorizontal, Users } from "lucide-react";
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
  email,
  active,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  email?: string;
  active: "brokers" | "clients" | "demo-leads" | "models" | "extractions";
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
            label="Brokers"
            icon={Building2}
            active={active === "brokers"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/clients"
            label="Clients"
            icon={Users}
            active={active === "clients"}
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
            href="/operator/models"
            label="Models"
            icon={SlidersHorizontal}
            active={active === "models"}
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
      <div className="border-t border-foreground/6 px-2 py-2">
        {!collapsed && email ? (
          <p className="truncate px-3 pb-2 text-label text-muted-foreground/60">
            {email}
          </p>
        ) : null}
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
