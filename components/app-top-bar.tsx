"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { BrokerShareLinkButton } from "@/components/broker-share-link-button";
import { typeStyle } from "@/lib/typography";

const BREADCRUMB_MAP: Record<string, { label: string; href?: string }> = {
  "/": { label: "Dashboard" },
  "/policies": { label: "Policies" },
  "/connect": { label: "Connect" },
  "/connect/clients": { label: "Clients", href: "/connect/clients" },
  "/connect/vendors": { label: "Vendors", href: "/connect/vendors" },
  "/connected-orgs": { label: "Connect", href: "/connect" },
  "/compliance": { label: "Compliance" },
  "/clients": { label: "Clients" },
  "/certificates": { label: "Certificates" },
  "/deliveries": { label: "Deliveries" },
  "/activity": { label: "Activity" },
  "/connections": { label: "Context" },
  "/agent": { label: "Agent Threads", href: "/policies" },
  "/settings": { label: "Settings" },
  "/profile": { label: "Profile" },
  "/operator": { label: "Clients", href: "/operator" },
  "/operator/clients": { label: "Clients", href: "/operator" },
  "/operator/brokers": { label: "Brokers" },
  "/operator/demo-leads": { label: "Demo leads" },
  "/operator/channels": { label: "Channels" },
  "/operator/routing": { label: "Routing" },
  "/operator/telemetry": { label: "Telemetry" },
  "/operator/profile": { label: "Profile" },
};

export function resolveAppBreadcrumb(pathname: string) {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  let matchedPath = normalizedPathname;
  let crumb = BREADCRUMB_MAP[normalizedPathname];
  if (!crumb) {
    const segments = normalizedPathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 1; i--) {
      const candidate = "/" + segments.slice(0, i).join("/");
      if (BREADCRUMB_MAP[candidate]) {
        matchedPath = candidate;
        crumb = BREADCRUMB_MAP[candidate];
        break;
      }
    }
  }

  return {
    label: crumb?.label ?? "Page",
    href: crumb?.href ?? matchedPath,
  };
}

export interface PresenceUser {
  userId: string;
  userName?: string;
  lastSeen: number;
}

function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  function getInitials(name?: string) {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, 4).map((u) => (
        <div
          key={u.userId}
          title={u.userName}
          className={`relative w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-foreground ${typeStyle("caption.medium")}`}
        >
          {getInitials(u.userName)}
          <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-400 border border-background" />
        </div>
      ))}
      {users.length > 4 && (
        <div className={`w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-muted-foreground ${typeStyle("caption.medium")}`}>
          +{users.length - 4}
        </div>
      )}
    </div>
  );
}

export function AppTopBar({
  actions,
  breadcrumbDetail,
  onMobileMenuToggle,
  presenceUsers,
  showBrokerShare = true,
}: {
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  presenceUsers?: PresenceUser[];
  showBrokerShare?: boolean;
}) {
  const pathname = usePathname();
  const { label, href } = resolveAppBreadcrumb(pathname);

  return (
    <header className="h-12 flex items-center gap-3 px-6 lg:px-8 border-b border-border shrink-0">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMobileMenuToggle}
        className="lg:hidden p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/4 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {breadcrumbDetail ? (
          <>
            <Link href={href} className={`hidden sm:inline text-muted-foreground/60 hover:text-foreground transition-colors truncate shrink-0 ${typeStyle("control.button")}`}>
              {label}
            </Link>
            <span className={`hidden sm:inline text-muted-foreground/30 ${typeStyle("body.default")}`}>/</span>
            <span className={`text-foreground truncate ${typeStyle("body.default")}`}>
              {breadcrumbDetail}
            </span>
          </>
        ) : (
          <span className={`text-foreground truncate ${typeStyle("body.medium")}`}>
            {label}
          </span>
        )}
      </div>

      {/* Presence + actions */}
      <div className="flex shrink-0 items-center gap-2" data-slot="app-top-bar-actions">
        {presenceUsers && presenceUsers.length > 0 && (
          <>
            <PresenceAvatars users={presenceUsers} />
            <div className="w-px h-4 bg-foreground/10" />
          </>
        )}
        {showBrokerShare ? <BrokerShareLinkButton /> : null}
        {actions}
      </div>
    </header>
  );
}
