"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  FileInput,
  Mail,
  Asterisk,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  LogOut,
  User,
  MessageSquare,
  Archive,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePageContext } from "@/hooks/use-page-context";
import { useTheme } from "@/hooks/use-theme";

const INSURANCE_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "D" },
  { href: "/policies", label: "Policies", icon: FileText, shortcut: "P" },
  { href: "/quotes", label: "Quotes", icon: ClipboardList, shortcut: "Q" },
  { href: "/applications", label: "Applications", icon: FileInput, shortcut: "A" },
];

const TOOLS_ITEMS = [
  { href: "/connections", label: "Connections", icon: Mail, shortcut: "C" },
  { href: "/agent", label: "Prism", icon: Asterisk, shortcut: "G" },
];

const ALL_NAV_ITEMS = [...INSURANCE_ITEMS, ...TOOLS_ITEMS];

/** Map from lowercase key to href for page shortcuts */
const PAGE_SHORTCUT_MAP: Record<string, string> = {
  ...Object.fromEntries(
    ALL_NAV_ITEMS.map((item) => [item.shortcut.toLowerCase(), item.href]),
  ),
  s: "/settings",
  i: "/profile",
};

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
  const router = useRouter();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const unifiedThreads = useQuery(api.threads.list, { archived: false });
  const webChats = useQuery(api.webChats.list, { archived: false });
  const emailConvs = useQuery(api.agentConversations.list, { archived: false });
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const { signOut } = useAuthActions();
  const { context: pageContext } = usePageContext();
  const { theme, cycle: cycleTheme } = useTheme();
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  const isAdmin = viewerOrg?.membership?.role === "admin";
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSending, setSearchSending] = useState(false);
  const [cmdHeld, setCmdHeld] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const cmdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      const threadId = await createThread({ agentDomain: AGENT_DOMAIN });
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to create chat");
    }
  }

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = searchQuery.trim();
    if (!content || searchSending) return;
    setSearchSending(true);
    try {
      const threadId = await createThread({ initialContext: pageContext ?? undefined, agentDomain: AGENT_DOMAIN });
      await sendThreadMessage({ threadId, content });
      setSearchQuery("");
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to start chat");
    } finally {
      setSearchSending(false);
    }
  }

  // Cmd+K search, Cmd+letter page nav, Cmd+number thread nav, Cmd held state
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (!cmdTimerRef.current) {
          setCmdHeld(true);
          cmdTimerRef.current = setTimeout(() => setShowShortcuts(true), 500);
        }

        // Cmd+K — focus search
        if (e.key === "k") {
          e.preventDefault();
          if (collapsed) {
            setCollapsed(false);
            setTimeout(() => searchInputRef.current?.focus(), 150);
          } else {
            searchInputRef.current?.focus();
          }
          return;
        }

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

      {/* Search / quick chat */}
      {!collapsed ? (
        <div className="px-3 pt-3 pb-1">
          <form onSubmit={handleSearchSubmit}>
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-foreground/6 focus-within:border-foreground/12 transition-colors">
              <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ask Prism..."
                className="flex-1 bg-transparent outline-none text-label-sm text-foreground placeholder:text-muted-foreground/40 min-w-0"
              />
            </div>
          </form>
        </div>
      ) : (
        <div className="px-2 pt-3 pb-1">
          <button
            type="button"
            onClick={() => { setCollapsed(false); setTimeout(() => searchInputRef.current?.focus(), 150); }}
            className="w-full flex items-center justify-center py-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
            title="Search"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {/* INSURANCE */}
        <SectionHeader label="Insurance" collapsed={collapsed} />
        {INSURANCE_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut}
            cmdHeld={showShortcuts}
          />
        ))}

        {/* TOOLS */}
        <SectionHeader label="Tools" collapsed={collapsed} />
        {TOOLS_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut}
            cmdHeld={showShortcuts}
          />
        ))}

        {/* CONVERSATIONS */}
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
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
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-body-sm transition-colors ${
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
                {showShortcuts && idx < 9 && (
                  <kbd className="text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded bg-foreground/[0.06] text-muted-foreground/50 border border-foreground/6 leading-none animate-in fade-in duration-150">
                    {idx + 1}
                  </kbd>
                )}
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
        <button
          type="button"
          onClick={cycleTheme}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-body-sm text-muted-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer ${
            collapsed ? "justify-center" : ""
          }`}
          title={`Theme: ${themeLabel}`}
        >
          <ThemeIcon className="w-4 h-4 shrink-0" />
          {!collapsed && <span>{themeLabel}</span>}
        </button>
        {isAdmin && (
          <NavItem
            href="/settings"
            label="Settings"
            icon={Settings}
            active={isActive("/settings")}
            collapsed={collapsed}
            shortcut="S"
            cmdHeld={showShortcuts}
          />
        )}
        <NavItem
          href="/profile"
          label="Profile"
          icon={User}
          active={isActive("/profile")}
          collapsed={collapsed}
          shortcut="I"
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

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full border-r border-foreground/6 bg-background sidebar-transition ${
          collapsed ? "w-14" : "w-[220px]"
        }`}
      >
        {sidebarContent}
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
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SectionHeader({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="pt-4 pb-1" />;
  return (
    <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider px-3 pt-5 pb-1.5">
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
