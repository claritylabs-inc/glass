"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  FileText,
  Mail,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  LogOut,
  User,
  MessageSquare,
  MessageCircle,
  Archive,
  ArrowLeft,
  Bell,
  ClipboardCheck,
  Building2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePageContext } from "@/hooks/use-page-context";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Users, Activity, UserPlus } from "lucide-react";
import {
  BROKER_SETTINGS_SECTIONS,
  CLIENT_SETTINGS_SECTIONS,
  insertSettingsSectionAfterTeam,
  type SettingsSection,
} from "@/lib/settings-sections";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { NotificationsPanel } from "@/components/notifications-panel";
import { MergePolicyDialog } from "@/components/merge-policy-dialog";
import { buildAgentContactVCard, downloadVCard } from "@/components/lib/agent-contact-vcard";
import {
  AGENT_TEXT_NUMBER,
  AGENT_TEXT_NUMBER_DISPLAY,
  IMESSAGE_CONTACT_ENABLED,
} from "@/lib/imessage-config";
import { getPublicAgentDomain } from "@/lib/domains";

const AGENT_DOMAIN = getPublicAgentDomain();

/** Wrapper so LogoIcon matches the lucide icon interface */
function GlassStarIcon({ className }: { className?: string }) {
  return <LogoIcon size={16} static className={className} />;
}

const AGENT_SETTINGS_SECTION: SettingsSection = { id: "agent", label: "Agent", icon: GlassStarIcon };

const CLIENT_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  CLIENT_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);
const BROKER_SETTINGS_WITH_AGENT = insertSettingsSectionAfterTeam(
  BROKER_SETTINGS_SECTIONS,
  AGENT_SETTINGS_SECTION,
);

const INSURANCE_ITEMS = [
  { href: "/policies", label: "Policies", icon: FileText, shortcut: "O" },
  { href: "/compliance", label: "Compliance", icon: ClipboardCheck },
];

const CONNECT_ITEMS = [
  { href: "/connect/clients", label: "Clients", icon: Users },
  { href: "/connect/vendors", label: "Vendors", icon: Building2 },
];

const ALL_NAV_ITEMS = [...INSURANCE_ITEMS];

const BROKER_NAV_ITEMS = [
  { href: "/clients", label: "Clients", icon: Users, shortcut: "K" },
  { href: "/compliance", label: "Compliance", icon: ClipboardCheck },
  { href: "/activity", label: "Activity", icon: Activity, shortcut: "U" },
];

/** Returns true if focus is inside an editable element */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function getInitials(name?: string | null, email?: string | null) {
  if (name) {
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

export function AppSidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isSettingsMode = pathname.startsWith("/settings");
  const clientDetailMatch = pathname.match(/^\/clients\/([^/]+)(\/.*)?$/);
  const isClientDetailMode = !!clientDetailMatch;
  const clientDetailId = clientDetailMatch?.[1];
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const unifiedThreads = useQuery(api.threads.list, { archived: false });
  const archivedThreads = useQuery(api.threads.list, { archived: true });
  const clientThreads = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).threads.listForClient,
    clientDetailId
      ? { clientOrgId: clientDetailId as Id<"organizations">, archived: false }
      : "skip",
  ) as
    | Array<{
        _id: string;
        _creationTime: number;
        title: string;
        lastMessageAt?: number;
        originChannel?: "chat" | "email" | "imessage";
        threadPhone?: string;
      }>
    | undefined;
  const createThread = useMutation(api.threads.create);
  const archiveThread = useMutation(api.threads.archive);
  const { signOut } = useAuthActions();
  const { clearCache: clearOnboardingCache } = useOnboardingCache();
  const { context: pageContext } = usePageContext();
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isStandaloneClient = currentOrg?.orgType === "client" && !viewerOrg?.brokerOrg;
  const navItems = isBroker ? BROKER_NAV_ITEMS : ALL_NAV_ITEMS;
  const connectItems = CONNECT_ITEMS;
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const pageShortcutMap = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(
        navItems.filter((item) => item.shortcut).map((item) => [item.shortcut!.toLowerCase(), item.href]),
      ),
      j: "/settings",
    }),
    [navItems],
  );

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const cmdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<{
    open: boolean;
    primaryPolicyId: string;
    secondaryPolicyId: string;
    notificationId?: Id<"notifications">;
  }>({ open: false, primaryPolicyId: "", secondaryPolicyId: "" });
  const unreadCount = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).notifications.unreadCount,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as number | undefined;

  // Unified thread list.
  const conversations = useMemo(() => {
    type ConvItem = { kind: "email" | "chat" | "imessage"; id: string; label: string; time: number };

    return (unifiedThreads ?? []).slice(0, 8).map((t): ConvItem => ({
      kind: t.originChannel === "imessage" ? "imessage" : t.originChannel === "email" ? "email" : "chat",
      id: t._id,
      label: t.title,
      time: t.lastMessageAt ?? t._creationTime,
    }));
  }, [unifiedThreads]);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", next ? "1" : "");
    } catch {}
  }

  // Close mobile drawer on navigation
  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/agent") return pathname === "/agent";
    return pathname.startsWith(href);
  }

  async function handleNewChat() {
    try {
      const threadId = await createThread({ initialContext: pageContext ?? undefined, agentDomain: AGENT_DOMAIN });
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to create chat");
    }
  }

  // Cmd+letter page nav, Cmd+number thread nav, Cmd held state
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (!cmdTimerRef.current) {
          cmdTimerRef.current = setTimeout(() => setShowShortcuts(true), 500);
        }

        // Skip navigation shortcuts when focus is in an editable element
        if (isEditableTarget(e)) return;

        // Cmd+letter — navigate to pages
        const pageHref = pageShortcutMap[e.key.toLowerCase()];
        if (pageHref) {
          e.preventDefault();
          router.push(pageHref);
          return;
        }

        // Cmd+1-9 — navigate to threads
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9 && num <= conversations.length) {
          e.preventDefault();
          router.push(`/agent/thread/${conversations[num - 1].id}`);
        }
      }
    }
    function clearCmd() {
      setShowShortcuts(false);
      if (cmdTimerRef.current) { clearTimeout(cmdTimerRef.current); cmdTimerRef.current = null; }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "Meta" || e.key === "Control") clearCmd();
    }
    function handleBlur() {
      clearCmd();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [collapsed, router, conversations, pageShortcutMap]);

  const partnerWhiteLabelingEnabled = viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false;
  const headerOrgName =
    partnerWhiteLabelingEnabled && viewerOrg?.brokerOrg
      ? viewerOrg.brokerOrg.name
      : viewerOrg?.org?.name ?? viewer?.name ?? viewer?.email ?? "";
  const headerOrgIcon =
    partnerWhiteLabelingEnabled && viewerOrg?.brokerOrg
      ? viewerOrg.brokerOrg.iconUrl
      : viewerOrg?.org?.iconUrl ?? null;
  const initials = getInitials(headerOrgName, viewer?.email);

  const activeSettingsSection = searchParams.get("section") ?? "organization";

  const settingsSidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header with collapse toggle */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-foreground/6">
        {!collapsed && (
          <Link
            href="/"
            className="flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span>Back</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-7 h-7 hidden lg:flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Settings nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {!collapsed && (
          <p className="text-[11px] font-medium text-muted-foreground/50 px-3 pt-3 pb-1.5">
            Settings
          </p>
        )}
        {collapsed && <div className="pt-4 pb-1" />}
        {(isBroker
          ? BROKER_SETTINGS_WITH_AGENT
          : isStandaloneClient
            ? CLIENT_SETTINGS_WITH_AGENT
            : CLIENT_SETTINGS_SECTIONS
        ).map((item) => {
          const isItemActive = item.id === activeSettingsSection;
          return (
            <NavItem
              key={item.id}
              href={`/settings?section=${item.id}`}
              label={item.label}
              icon={item.icon}
              active={isItemActive}
              collapsed={collapsed}
              cmdHeld={false}
            />
          );
        })}
      </nav>

      {/* Partner contact footer — only for clients */}
      {!isBroker && viewerOrg && !collapsed ? (
        <SidebarBrokerContact
          broker={viewerOrg.brokerOrg ?? null}
          fallbackAgentHandle={viewerOrg.org?.agentHandle}
        />
      ) : null}
    </div>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* User + collapse toggle */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-foreground/6">
        {!collapsed && (
          <>
            <div className={`ml-0.5 w-7 h-7 bg-foreground/8 flex items-center justify-center text-[11px] font-medium text-foreground shrink-0 overflow-hidden ${headerOrgIcon ? "rounded-md" : "rounded-full"}`}>
              {headerOrgIcon ? (
                <Image src={headerOrgIcon} alt="" width={28} height={28} unoptimized className="w-7 h-7 object-contain bg-white" />
              ) : viewer?.image ? (
                <Image src={viewer.image} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground truncate">{headerOrgName}</p>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-7 h-7 hidden lg:flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="relative px-2 py-2 border-b border-foreground/6">
        <button
          type="button"
          onClick={() => setNotificationsPanelOpen((v) => !v)}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-body-sm transition-colors cursor-pointer ${
            collapsed ? "justify-center" : ""
          } ${
            notificationsPanelOpen
              ? "text-foreground bg-foreground/[0.05]"
              : "text-muted-foreground hover:bg-foreground/[0.04]"
          }`}
          title={collapsed ? "Notifications" : undefined}
        >
          <Bell className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Notifications</span>}
          {(unreadCount ?? 0) > 0 && (
            <span
              className={`flex items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-medium leading-none shrink-0 ${
                collapsed ? "w-4 h-4" : "min-w-[18px] h-4 px-1"
              }`}
            >
              {unreadCount! > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        {notificationsPanelOpen && !isDesktop && currentOrg?.orgId && (
          <NotificationsPanel
            orgId={currentOrg.orgId}
            onClose={() => setNotificationsPanelOpen(false)}
            onMergeSuggestion={(payload) =>
              setMergeDialog({
                open: true,
                primaryPolicyId: payload.primaryPolicyId,
                secondaryPolicyId: payload.secondaryPolicyId,
              })
            }
          />
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {/* MAIN NAV */}
        <SectionHeader label={isBroker ? "Partner" : "Insurance"} collapsed={collapsed} />
        {navItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut ?? undefined}
            cmdHeld={showShortcuts}
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
            cmdHeld={showShortcuts}
          />
        ))}

        {/* CONVERSATIONS — brokers don't get an agent chat; they view client threads via /clients/[id]/threads */}
        {isBroker ? null : !collapsed ? (
          <>
            <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground/50 ">
                Threads
              </span>
              {conversations.length > 0 && (
                <PillButton
                  type="button"
                  size="compact"
                  variant="icon"
                  onClick={handleNewChat}
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
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 px-3 py-1 rounded-md text-label-sm text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>New chat</span>
              </button>
            )}
            {conversations.map((item, idx) => {
              const isConvActive = pathname === `/agent/thread/${item.id}`;
              return (
              <Link
                key={`${item.kind}-${item.id}`}
                href={`/agent/thread/${item.id}`}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-body-sm transition-colors ${
                  isConvActive
                    ? "text-foreground bg-foreground/[0.05]"
                    : "text-muted-foreground hover:bg-foreground/[0.04]"
                }`}
              >
                {item.kind === "imessage" ? (
                  <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                ) : item.kind === "email" ? (
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                ) : null}
                <span className="truncate flex-1">{item.label}</span>
                {/* Shortcut hint — hidden when archive button shows */}
                {showShortcuts && idx < 9 && (
                  <kbd className="text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded bg-foreground/[0.06] text-muted-foreground/50 border border-foreground/6 leading-none animate-in fade-in duration-150 group-hover:hidden">
                    {idx + 1}
                  </kbd>
                )}
                {/* Archive button — same size/shape as the + button above */}
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await archiveThread({ id: item.id as Id<"threads"> });
                    if (isConvActive) {
                      const next = conversations.find((c) => c.id !== item.id);
                      if (next) {
                        router.push(`/agent/thread/${next.id}`);
                      } else {
                        // No unarchived threads left — start a new one
                        const threadId = await createThread({ agentDomain: AGENT_DOMAIN });
                        router.push(`/agent/thread/${threadId}`);
                      }
                    }
                  }}
                  className="hidden group-hover:flex w-5 h-5 items-center justify-center rounded text-muted-foreground/30 hover:text-foreground hover:bg-foreground/[0.06] transition-colors cursor-pointer shrink-0"
                  title="Archive"
                >
                  <Archive className="w-3 h-3" />
                </button>
              </Link>
              );
            })}
            {archivedThreads && archivedThreads.length > 0 && (
              <Link
                href="/agent/archive"
                className="flex items-center gap-2 px-3 py-1 rounded-md text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-foreground/[0.03] transition-colors mt-0.5"
              >
                <Archive className="w-3 h-3 shrink-0" />
                <span>Archived</span>
              </Link>
            )}
          </>
        ) : (
          <>
            <div className="pt-4 pb-1" />
            {conversations.slice(0, 5).map((item) => {
              const isConvActive = pathname === `/agent/thread/${item.id}`;
              return (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={`/agent/thread/${item.id}`}
                  title={item.label}
                  className={`flex items-center justify-center py-1.5 rounded-md transition-colors ${
                    isConvActive
                      ? "text-foreground bg-foreground/[0.05]"
                      : "text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04]"
                  }`}
                >
                {item.kind === "imessage" ? (
                  <MessageCircle className="w-3.5 h-3.5" />
                ) : item.kind === "email" ? (
                  <Mail className="w-3.5 h-3.5" />
                ) : null}
                </Link>
              );
            })}
            <div className="flex items-center justify-center mt-0.5">
              <PillButton
                type="button"
                size="compact"
                variant="icon"
                onClick={handleNewChat}
                title="New thread"
                aria-label="New thread"
              >
                <Plus className="w-3.5 h-3.5" />
              </PillButton>
            </div>
          </>
        )}
      </nav>

      {/* Partner contact footer — only for clients */}
      {!isBroker && viewerOrg && !collapsed ? (
        <SidebarBrokerContact
          broker={viewerOrg.brokerOrg ?? null}
          fallbackAgentHandle={viewerOrg.org?.agentHandle}
        />
      ) : null}

      {/* Bottom section */}
      <div className="border-t border-foreground/6 px-2 py-2 space-y-0.5">
        <NavItem
          href="/settings"
          label="Settings"
          icon={Settings}
          active={isActive("/settings")}
          collapsed={collapsed}
          shortcut="J"
          cmdHeld={showShortcuts}
        />
        <NavItem
          href="/profile"
          label="Profile"
          icon={User}
          active={isActive("/profile")}
          collapsed={collapsed}
          cmdHeld={showShortcuts}
        />
        <button
          type="button"
          onClick={() => {
            clearOnboardingCache();
            signOut();
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-body-sm text-muted-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </div>
  );

  const clientDetailBase = clientDetailId ? `/clients/${clientDetailId}` : "";
  const CLIENT_DETAIL_NAV: {
    id: string;
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "details", label: "Details", href: "", icon: User },
    { id: "policies", label: "Policies", href: "/policies", icon: FileText },
    { id: "activity", label: "Activity", href: "/activity", icon: Activity },
    { id: "settings", label: "Settings", href: "/settings", icon: Settings },
  ];

  function isClientNavActive(href: string) {
    const full = `${clientDetailBase}${href}`;
    if (href === "") return pathname === clientDetailBase || pathname === `${clientDetailBase}/`;
    return pathname === full || pathname.startsWith(`${full}/`);
  }

  const clientDetailSidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-foreground/6">
        {!collapsed && (
          <>
            <div className={`ml-0.5 w-7 h-7 bg-foreground/8 flex items-center justify-center text-[11px] font-medium text-foreground shrink-0 overflow-hidden ${headerOrgIcon ? "rounded-md" : "rounded-full"}`}>
              {headerOrgIcon ? (
                <Image src={headerOrgIcon} alt="" width={28} height={28} unoptimized className="w-7 h-7 object-contain bg-white" />
              ) : viewer?.image ? (
                <Image src={viewer.image} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground truncate">{headerOrgName}</p>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-7 h-7 hidden lg:flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {!collapsed && (
          <p className="text-[11px] font-medium text-muted-foreground/50 px-3 pt-3 pb-1.5">
            Client
          </p>
        )}
        {collapsed && <div className="pt-4 pb-1" />}
        <NavItem
          href="/clients"
          label="Clients"
          icon={ArrowLeft}
          active={false}
          collapsed={collapsed}
          cmdHeld={false}
        />
        {CLIENT_DETAIL_NAV.map((item) => (
          <NavItem
            key={item.id}
            href={`${clientDetailBase}${item.href}`}
            label={item.label}
            icon={item.icon}
            active={isClientNavActive(item.href)}
            collapsed={collapsed}
            cmdHeld={false}
          />
        ))}

        {/* Client threads — read-only list for brokers */}
        {!collapsed && clientDetailId && (
          <>
            <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground/50">
                Threads
              </span>
            </div>
            {clientThreads === undefined && (
              <p className="px-3 py-1 text-label-sm text-muted-foreground/40">
                Loading…
              </p>
            )}
            {clientThreads && clientThreads.length === 0 && (
              <p className="px-3 py-1 text-label-sm text-muted-foreground/40">
                No threads
              </p>
            )}
            {clientThreads?.slice(0, 8).map((item) => {
              const href = `/clients/${clientDetailId}/threads/${item._id}`;
              const isConvActive = pathname === href;
              return (
                <Link
                  key={item._id}
                  href={href}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-body-sm transition-colors ${
                    isConvActive
                      ? "text-foreground bg-foreground/[0.05]"
                      : "text-muted-foreground hover:bg-foreground/[0.04]"
                  }`}
                >
                  {item.originChannel === "imessage" ? (
                    <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                  ) : item.originChannel === "email" ? (
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                  ) : null}
                  <span className="truncate flex-1">{item.title}</span>
                </Link>
              );
            })}
            <Link
              href={`/clients/${clientDetailId}/threads`}
              className="flex items-center gap-2 px-3 py-1 rounded-md text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-foreground/[0.03] transition-colors mt-0.5"
            >
              <MessageSquare className="w-3 h-3 shrink-0" />
              <span>All threads</span>
            </Link>
          </>
        )}
      </nav>
    </div>
  );

  const activeContent = isClientDetailMode
    ? clientDetailSidebarContent
    : isSettingsMode
      ? settingsSidebarContent
      : sidebarContent;

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full border-r border-foreground/6 bg-background sidebar-transition ${
          collapsed ? "w-14" : "w-[220px]"
        }`}
      >
        {activeContent}
      </aside>

      {notificationsPanelOpen && isDesktop && currentOrg?.orgId && (
        <aside className="hidden h-full w-80 min-w-80 max-w-80 shrink-0 overflow-hidden lg:flex">
          <NotificationsPanel
            orgId={currentOrg.orgId}
            variant="pane"
            onClose={() => setNotificationsPanelOpen(false)}
            onMergeSuggestion={(payload) =>
              setMergeDialog({
                open: true,
                primaryPolicyId: payload.primaryPolicyId,
                secondaryPolicyId: payload.secondaryPolicyId,
              })
            }
          />
        </aside>
      )}

      {/* Mobile overlay drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/20 z-40 lg:hidden"
              onClick={onMobileClose}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 30, stiffness: 300, bounce: 0 }}
              className="fixed left-0 top-0 bottom-0 w-[260px] z-50 bg-background border-r border-foreground/6 lg:hidden"
            >
              {activeContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <MergePolicyDialog
        open={mergeDialog.open}
        onClose={() => setMergeDialog((d) => ({ ...d, open: false }))}
        primaryPolicyId={mergeDialog.primaryPolicyId}
        secondaryPolicyId={mergeDialog.secondaryPolicyId}
        notificationId={mergeDialog.notificationId}
      />
    </>
  );
}

function SidebarBrokerContact({
  broker,
  fallbackAgentHandle,
}: {
  broker: {
    name: string;
    iconUrl?: string | null;
    whiteLabelingEnabled?: boolean;
    brandingColor?: string;
    agentHandle?: string;
    primaryContact: {
      userId: string;
      name?: string;
      email?: string;
      title?: string;
    } | null;
  } | null;
  fallbackAgentHandle?: string;
}) {
  // When no broker is linked, fall back to Glass defaults so the user still
  // sees who to contact (the standard agent email).
  const isGlassFallback = !broker;
  const name = broker?.name ?? "Ask Glass";
  const iconUrl = broker?.iconUrl ?? null;
  const brandColor = broker?.brandingColor ?? "#000000";
  const primaryContact = broker?.primaryContact ?? null;
  const handle = broker?.agentHandle ?? fallbackAgentHandle;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : `agent@${AGENT_DOMAIN}`;
  const initial = name.charAt(0).toUpperCase();

  const handleSaveContact = async () => {
    if (!agentEmail) return;
    const { vcard, fileName } = await buildAgentContactVCard({
      broker,
      email: agentEmail,
      phone: IMESSAGE_CONTACT_ENABLED ? AGENT_TEXT_NUMBER : undefined,
    });
    downloadVCard(vcard, fileName);
  };
  return (
    <div className="border-t border-foreground/6 px-3 py-3">
      <div className="rounded-lg border border-foreground/6 bg-card px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`h-8 w-8 shrink-0 overflow-hidden rounded-md flex items-center justify-center ${
              isGlassFallback
                ? "bg-white ring-1 ring-inset ring-foreground/10"
                : "ring-1 ring-inset ring-white/10"
            }`}
            style={
              isGlassFallback
                ? undefined
                : {
                    background: `linear-gradient(135deg, ${brandColor} 0%, ${brandColor}cc 60%, ${brandColor}88 100%)`,
                  }
            }
          >
            {isGlassFallback ? (
              // Glass globe is rendered at text scale (not filling the tile)
              // because that's how the brand mark is meant to read.
              <LogoIcon size={14} static color="#000000" />
            ) : iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="h-full w-full object-contain bg-white" />
            ) : (
              <span className="text-sm font-semibold text-white">{initial}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-medium text-foreground truncate">{name}</p>
            {primaryContact?.name ? (
              <p className="text-label-sm text-muted-foreground truncate">
                {primaryContact.name}
              </p>
            ) : null}
          </div>
        </div>
        {(primaryContact?.email || agentEmail) && (
          <div className="mt-2 space-y-1">
            {primaryContact?.email ? (
              <a
                href={`mailto:${primaryContact.email}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
              >
                {primaryContact.email}
              </a>
            ) : null}
            {agentEmail ? (
              <a
                href={`mailto:${agentEmail}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
                title={broker ? "Partner assistant" : "Glass assistant"}
              >
                {agentEmail}
              </a>
            ) : null}
            {IMESSAGE_CONTACT_ENABLED ? (
              <a
                href={`sms:${AGENT_TEXT_NUMBER}`}
                className="block text-label-sm text-muted-foreground hover:text-foreground truncate"
              >
                {AGENT_TEXT_NUMBER_DISPLAY}
              </a>
            ) : null}
          </div>
        )}
        {agentEmail ? (
          <div className="mt-2.5 flex flex-col gap-1.5 lg:flex-row">
            <PillButton
              variant="primary"
              size="compact"
              className="hidden lg:inline-flex flex-1"
              onClick={() => {
                window.location.href = `mailto:${agentEmail}`;
              }}
            >
              <Mail className="h-3 w-3" />
              <span className="whitespace-nowrap">Email agent</span>
            </PillButton>
            {IMESSAGE_CONTACT_ENABLED ? (
              <PillButton
                variant="primary"
                size="compact"
                className="w-full lg:hidden"
                onClick={() => {
                  window.location.href = `sms:${AGENT_TEXT_NUMBER}`;
                }}
              >
                <MessageSquare className="h-3 w-3" />
                <span className="whitespace-nowrap">Text My Agent</span>
              </PillButton>
            ) : null}
            <PillButton
              variant="secondary"
              size="compact"
              onClick={handleSaveContact}
              title="Save as contact"
              aria-label="Save as contact"
            >
              <UserPlus className="h-3 w-3" />
              <span className="whitespace-nowrap lg:hidden">Save contact</span>
            </PillButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeader({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="pt-4 pb-1" />;
  return (
    <p className="text-[11px] font-medium text-muted-foreground/50  px-3 pt-5 pb-1.5">
      {label}
    </p>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  shortcut,
  cmdHeld,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  shortcut?: string;
  cmdHeld?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-body-sm transition-colors ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "text-foreground bg-foreground/[0.05]"
          : "text-muted-foreground hover:bg-foreground/[0.04]"
      }`}
      title={collapsed ? label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && cmdHeld && shortcut != null && (
        <kbd className="text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded bg-foreground/[0.06] text-muted-foreground/50 border border-foreground/6 leading-none animate-in fade-in duration-150">
          {shortcut}
        </kbd>
      )}
    </Link>
  );
}
