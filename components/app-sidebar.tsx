"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";
import {
  FileText,
  FileInput,
  Mail,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  LogOut,
  User,
  MessageSquare,
  Archive,
  ArrowLeft,
  Bell,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePageContext } from "@/hooks/use-page-context";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { LogoIcon } from "@/components/ui/logo-icon";
import { NotificationsPanel } from "@/components/notifications-panel";
import { MergePolicyDialog } from "@/components/merge-policy-dialog";
import type { Id } from "@/convex/_generated/dataModel";

/** Wrapper so LogoIcon matches the lucide icon interface */
function PrismStarIcon({ className }: { className?: string }) {
  return <LogoIcon size={16} static className={className} />;
}

const SETTINGS_SECTIONS_WITH_AGENT = [
  ...SETTINGS_SECTIONS,
  { id: "agent", label: "Agent", icon: PrismStarIcon },
];

const INSURANCE_ITEMS = [
  { href: "/policies", label: "Policies", icon: FileText, shortcut: "O" },
  { href: "/applications", label: "Applications", icon: FileInput, shortcut: "Y" },
];

const ALL_NAV_ITEMS = [...INSURANCE_ITEMS];

/** Map from lowercase key to href for page shortcuts.
 * Avoids: A (select all), C (copy), V (paste), X (cut), S (save),
 * P (print), I (italic/devtools), Z (undo), F (find), R (reload),
 * N (new window), T (new tab), W (close tab), Q (quit), L (address bar),
 * B (bold), H (history)
 */
const PAGE_SHORTCUT_MAP: Record<string, string> = {
  ...Object.fromEntries(
    ALL_NAV_ITEMS.filter((item) => item.shortcut).map((item) => [item.shortcut!.toLowerCase(), item.href]),
  ),
  j: "/settings",
  // /profile accessible via sidebar only (no shortcut)
};

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
  const viewer = useQuery(api.users.viewer);
  const unifiedThreads = useQuery(api.threads.list, { archived: false });
  const webChats = useQuery(api.webChats.list, { archived: false });
  const emailConvs = useQuery(api.agentConversations.list, { archived: false });
  const createThread = useMutation(api.threads.create);
  const archiveThread = useMutation(api.threads.archive);
  const { signOut } = useAuthActions();
  const { context: pageContext } = usePageContext();

  const [collapsed, setCollapsed] = useState(false);
  const [cmdHeld, setCmdHeld] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const cmdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<{
    open: boolean;
    primaryPolicyId: string;
    secondaryPolicyId: string;
    notificationId?: Id<"notifications">;
  }>({ open: false, primaryPolicyId: "", secondaryPolicyId: "" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unreadCount = useQuery((api as any).notifications.unreadCount) as number | undefined;

  // Unified thread list — prefers unified threads table, falls back to legacy merge
  const conversations = useMemo(() => {
    type ConvItem = { kind: "email" | "chat"; id: string; label: string; time: number };

    // If unified threads have data, use them directly
    if (unifiedThreads && unifiedThreads.length > 0) {
      return unifiedThreads.slice(0, 8).map((t): ConvItem => ({
        kind: t.legacyConversationId ? "email" : "chat",
        id: t._id,
        label: t.title,
        time: t.lastMessageAt ?? t._creationTime,
      }));
    }

    // Fallback: merge legacy tables
    const items: ConvItem[] = [];
    if (emailConvs) {
      const threadMap = new Map<string, { subject: string; time: number }>();
      for (const conv of emailConvs) {
        const rootId = (conv.threadId ?? conv._id) as string;
        const existing = threadMap.get(rootId);
        if (existing) {
          if (conv._creationTime > existing.time) existing.time = conv._creationTime;
        } else {
          threadMap.set(rootId, { subject: conv.subject, time: conv._creationTime });
        }
      }
      for (const [id, { subject, time }] of threadMap) {
        items.push({ kind: "email", id, label: subject, time });
      }
    }
    if (webChats) {
      for (const chat of webChats) {
        items.push({ kind: "chat", id: chat._id, label: chat.title, time: chat.lastMessageAt ?? chat._creationTime });
      }
    }
    return items.sort((a, b) => b.time - a.time).slice(0, 8);
  }, [unifiedThreads, emailConvs, webChats]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar-collapsed");
      if (stored === "1") setCollapsed(true);
    } catch {}
  }, []);

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
          setCmdHeld(true);
          cmdTimerRef.current = setTimeout(() => setShowShortcuts(true), 500);
        }

        // Skip navigation shortcuts when focus is in an editable element
        if (isEditableTarget(e)) return;

        // Cmd+letter — navigate to pages
        const pageHref = PAGE_SHORTCUT_MAP[e.key.toLowerCase()];
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
      setCmdHeld(false);
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
  }, [collapsed, router, conversations]);

  const initials = getInitials(viewer?.name, viewer?.email);

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
        {SETTINGS_SECTIONS_WITH_AGENT.map((item) => {
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
    </div>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* User + collapse toggle */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-foreground/6">
        {!collapsed && (
          <>
            <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center text-[11px] font-medium text-foreground shrink-0">
              {viewer?.image ? (
                <img src={viewer.image} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground truncate">
                {viewer?.name || viewer?.email || ""}
              </p>
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

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {/* INSURANCE */}
        <SectionHeader label="Insurance" collapsed={collapsed} />
        <div className="relative">
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
          {notificationsPanelOpen && (
            <NotificationsPanel
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
        {INSURANCE_ITEMS.map((item) => (
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

        {/* CONVERSATIONS */}
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground/50 ">
                Threads
              </span>
              <button
                type="button"
                onClick={handleNewChat}
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {conversations.length === 0 && (
              <p className="px-3 py-1 text-label-sm text-muted-foreground/30">
                No conversations yet
              </p>
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
                {item.kind === "chat" ? (
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                )}
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
                    await archiveThread({ id: item.id as any });
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
            <Link
              href="/agent/archive"
              className="flex items-center gap-2 px-3 py-1 rounded-md text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-foreground/[0.03] transition-colors mt-0.5"
            >
              <Archive className="w-3 h-3 shrink-0" />
              <span>Archived</span>
            </Link>
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
                  {item.kind === "chat" ? (
                    <MessageSquare className="w-3.5 h-3.5" />
                  ) : (
                    <Mail className="w-3.5 h-3.5" />
                  )}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={handleNewChat}
              title="New chat"
              className="w-full flex items-center justify-center py-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer mt-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </nav>

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
          onClick={() => signOut()}
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

  const activeContent = isSettingsMode ? settingsSidebarContent : sidebarContent;

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
