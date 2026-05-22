"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Activity, Building2, LogOut, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { NavItem, SectionHeader } from "@/components/app-sidebar/nav-item";
import { MENU_ITEM_BASE, MENU_ITEM_INACTIVE } from "@/components/app-sidebar/nav-config";
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
  active: "brokers" | "clients" | "mgas" | "models" | "extractions";
}) {
  const { signOut } = useAuthActions();

  return (
    <>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Operator"
        onToggleCollapse={onToggleCollapse}
        icon={<LogoIcon size={15} static />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        <SectionHeader label="Internal" collapsed={collapsed} />
        <NavItem
          href="/operator"
          label="Brokers"
          icon={Building2}
          active={active === "brokers"}
          collapsed={collapsed}
        />
        <NavItem
          href="/operator/clients"
          label="Clients"
          icon={Users}
          active={active === "clients"}
          collapsed={collapsed}
        />
        <NavItem
          href="/operator/mgas"
          label="MGAs"
          icon={ShieldCheck}
          active={active === "mgas"}
          collapsed={collapsed}
        />
        <NavItem
          href="/operator/models"
          label="Models"
          icon={SlidersHorizontal}
          active={active === "models"}
          collapsed={collapsed}
        />
        <NavItem
          href="/operator/extractions"
          label="Extractions"
          icon={Activity}
          active={active === "extractions"}
          collapsed={collapsed}
        />
      </div>
      <div className="border-t border-foreground/6 px-2 py-2">
        {!collapsed && email ? (
          <p className="truncate px-3 pb-2 text-label-sm text-muted-foreground/60">
            {email}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-body-sm ${
            collapsed ? "justify-center" : ""
          } ${MENU_ITEM_BASE} ${MENU_ITEM_INACTIVE}`}
          aria-label={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed ? <span className="flex-1 text-left">Sign out</span> : null}
        </button>
      </div>
    </>
  );
}
