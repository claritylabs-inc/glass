"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Settings,
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

type OperatorClientNavigationSection =
  | "overview"
  | "policies"
  | "compliance"
  | "certificates"
  | "team"
  | "settings";

const INSURANCE_NAV_ITEMS = [
  { id: "policies", label: "Policies", href: "/policies", icon: FileText },
  {
    id: "compliance",
    label: "Compliance",
    href: "/compliance",
    icon: ClipboardCheck,
  },
  {
    id: "certificates",
    label: "Certificates",
    href: "/certificates",
    icon: BadgeCheck,
  },
] as const;

function activeClientSection({
  pathname,
  tab,
  basePath,
}: {
  pathname: string;
  tab: string | null;
  basePath: string;
}): OperatorClientNavigationSection {
  if (
    pathname === `${basePath}/policies` ||
    pathname.startsWith(`${basePath}/policies/`)
  ) {
    return "policies";
  }
  if (
    pathname === `${basePath}/compliance` ||
    pathname.startsWith(`${basePath}/compliance/`)
  ) {
    return "compliance";
  }
  if (
    pathname === `${basePath}/certificates` ||
    pathname.startsWith(`${basePath}/certificates/`)
  ) {
    return "certificates";
  }
  if (pathname === basePath || pathname === `${basePath}/`) {
    if (tab === "team") return "team";
    if (
      ["features", "channels", "email", "imessage", "slack"].includes(
        tab ?? "",
      )
    ) {
      return "settings";
    }
  }
  return "overview";
}

export function OperatorClientSidebar({
  collapsed,
  onToggleCollapse,
  clientOrgId,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  clientOrgId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = `/operator/clients/${clientOrgId}`;
  const active = activeClientSection({
    pathname,
    tab: searchParams.get("tab"),
    basePath,
  });

  return (
    <SidebarTooltipProvider>
      <div className="flex h-full flex-col">
        <SidebarHeader
          collapsed={collapsed}
          initials="OP"
          headerOrgName="Operator"
          onToggleCollapse={onToggleCollapse}
          icon={<LogoIcon size={15} static />}
        />

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          <SectionHeader label="Client" collapsed={collapsed} />
          <SidebarMenuItem
            href="/operator"
            label="Clients"
            icon={ArrowLeft}
            active={false}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href={basePath}
            label="Overview"
            icon={User}
            active={active === "overview"}
            collapsed={collapsed}
          />

          <SectionHeader label="Insurance" collapsed={collapsed} />
          {INSURANCE_NAV_ITEMS.map((item) => (
            <SidebarMenuItem
              key={item.id}
              href={`${basePath}${item.href}`}
              label={item.label}
              icon={item.icon}
              active={active === item.id}
              collapsed={collapsed}
            />
          ))}

          <SectionHeader label="Settings" collapsed={collapsed} />
          <SidebarMenuItem
            href={`${basePath}?tab=team`}
            label="Team"
            icon={Users}
            active={active === "team"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href={`${basePath}?tab=features`}
            label="Settings"
            icon={Settings}
            active={active === "settings"}
            collapsed={collapsed}
          />
        </nav>
      </div>
    </SidebarTooltipProvider>
  );
}
