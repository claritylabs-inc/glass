"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { BrokerShareLinkButton } from "@/components/broker-share-link-button";

const BREADCRUMB_MAP: Record<string, { label: string; href?: string }> = {
  "/": { label: "Dashboard" },
  "/policies": { label: "Policies" },
  "/clients": { label: "Clients" },
  "/activity": { label: "Activity" },
  "/connections": { label: "Context" },
  "/agent": { label: "Agent Threads", href: "/policies" },
  "/settings": { label: "Settings" },
  "/profile": { label: "Profile" },
};

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
          className="relative w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-[9px] font-medium text-foreground"
        >
          {getInitials(u.userName)}
          <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-400 border border-background" />
        </div>
      ))}
      {users.length > 4 && (
        <div className="w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground">
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
}: {
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  presenceUsers?: PresenceUser[];
}) {
  const pathname = usePathname();

  // Find matching breadcrumb — walk up path segments until we find a match
  let matchedPath = pathname;
  let crumb = BREADCRUMB_MAP[pathname];
  if (!crumb) {
    const segments = pathname.split("/").filter(Boolean);
    // Try progressively shorter paths (e.g. /agent/thread/[id] -> /agent/thread -> /agent)
    for (let i = segments.length - 1; i >= 1; i--) {
      const candidate = "/" + segments.slice(0, i).join("/");
      if (BREADCRUMB_MAP[candidate]) {
        matchedPath = candidate;
        crumb = BREADCRUMB_MAP[candidate];
        break;
      }
    }
    if (!crumb && segments.length >= 1) {
      matchedPath = "/" + segments[0];
      crumb = BREADCRUMB_MAP[matchedPath];
    }
  }

  const label = crumb?.label ?? "Page";
  const href = crumb?.href ?? matchedPath;

  return (
    <header className="h-12 flex items-center gap-3 px-6 lg:px-8 border-b border-foreground/6 shrink-0">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMobileMenuToggle}
        className="lg:hidden p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {breadcrumbDetail ? (
          <>
            <Link href={href} className="hidden sm:inline text-body-sm font-medium text-muted-foreground/60 hover:text-foreground transition-colors truncate shrink-0">
              {label}
            </Link>
            <span className="hidden sm:inline text-muted-foreground/30 text-body-sm">/</span>
            <span className="text-body-sm text-foreground truncate">
              {breadcrumbDetail}
            </span>
          </>
        ) : (
          <span className="text-body-sm font-medium text-foreground truncate">
            {label}
          </span>
        )}
      </div>

      {/* Presence + actions */}
      <div className="flex items-center gap-3 shrink-0">
        {presenceUsers && presenceUsers.length > 0 && (
          <>
            <PresenceAvatars users={presenceUsers} />
            <div className="w-px h-4 bg-foreground/10" />
          </>
        )}
        <BrokerShareLinkButton />
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
