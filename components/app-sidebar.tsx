"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { usePageContext } from "@/hooks/use-page-context";
import { MergePolicyDialog } from "@/components/merge-policy-dialog";
import { NotificationsPanel } from "@/components/notifications-panel";
import { ClientDetailSidebarContent } from "@/components/app-sidebar/client-detail-sidebar-content";
import { MainSidebarContent } from "@/components/app-sidebar/main-sidebar-content";
import {
  AGENT_DOMAIN,
  ALL_NAV_ITEMS,
  BROKER_NAV_ITEMS,
  CONNECT_ITEMS,
  NO_CONNECT_ITEMS,
  PARTNER_NAV_ITEMS,
  SHORTCUT_PREFIX_KEY,
  SHORTCUT_SEQUENCE_TIMEOUT_MS,
} from "@/components/app-sidebar/nav-config";
import { SettingsSidebarContent } from "@/components/app-sidebar/settings-sidebar-content";
import type {
  ClientThreadItem,
  ConversationItem,
  MergeSuggestionPayload,
} from "@/components/app-sidebar/types";
import {
  getInitials,
  isEditableTarget,
  useMediaQuery,
} from "@/components/app-sidebar/utils";
import { useCachedQuery, useSetCachedQuery } from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useArchivedThreadCacheActions } from "@/lib/sync/glass-cached-queries";

function sidebarHeaderBranding({
  viewerOrg,
  viewerName,
  viewerEmail,
}: {
  viewerOrg:
    | {
        org?: {
          name?: string;
          iconUrl?: string | null;
        } | null;
        brokerOrg?: {
          name: string;
          iconUrl?: string | null;
          whiteLabelingEnabled?: boolean;
        } | null;
      }
    | null
    | undefined;
  viewerName?: string | null;
  viewerEmail?: string | null;
}) {
  const brokerBrandingEnabled =
    viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false;
  const brandedOrg =
    brokerBrandingEnabled && viewerOrg?.brokerOrg
      ? viewerOrg.brokerOrg
      : viewerOrg?.org;

  return {
    name: brandedOrg?.name ?? viewerName ?? viewerEmail ?? "",
    iconUrl: brandedOrg?.iconUrl ?? null,
  };
}

export function AppSidebar({
  mobileOpen,
  onMobileClose,
  onAskGlass,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onAskGlass?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isSettingsMode = pathname.startsWith("/settings");
  const clientDetailMatch = pathname.match(/^\/clients\/([^/]+)(\/.*)?$/);
  const isClientDetailMode = !!clientDetailMatch;
  const clientDetailId = clientDetailMatch?.[1];

  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const viewerOrg = useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
  const brokerPageContext = useCachedQuery(
    "orgs.getBrokerPageContext",
    api.orgs.getBrokerPageContext,
    {},
  );
  const unifiedThreads = useCachedQuery(
    "threads.list.active",
    api.threads.list,
    { archived: false },
  );
  const archivedThreads = useCachedQuery(
    "threads.list.archived",
    api.threads.list,
    { archived: true },
  );
  const setThreadDetail = useSetCachedQuery<
    NonNullable<typeof unifiedThreads>[number],
    { id: Id<"threads"> }
  >("threads.get.current");
  const clientThreads = useCachedQuery(
    "threads.listForClient.sidebar",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).threads.listForClient,
    clientDetailId
      ? { clientOrgId: clientDetailId as Id<"organizations">, archived: false }
      : "skip",
  ) as ClientThreadItem[] | undefined;
  const createThread = useMutation(api.threads.create);
  const archiveThread = useMutation(api.threads.archive);
  const { archiveThreadLocally } = useArchivedThreadCacheActions();
  const { signOut } = useAuthActions();
  const { clearCache: clearOnboardingCache } = useOnboardingCache();
  const { context: pageContext } = usePageContext();
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isStandaloneClient =
    currentOrg?.orgType === "client" && !viewerOrg?.brokerOrg;
  const isPartner = currentOrg?.isPartner ?? false;
  const canManageSettings = currentOrg?.role === "admin";
  const navItems = (
    isPartner ? PARTNER_NAV_ITEMS : isBroker ? BROKER_NAV_ITEMS : ALL_NAV_ITEMS
  ).filter(
    (item) => item.href !== "/broker" || brokerPageContext?.showBrokerPage,
  );
  const connectItems = isBroker || isPartner ? NO_CONNECT_ITEMS : CONNECT_ITEMS;
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    const rows = [...(unifiedThreads ?? []), ...(archivedThreads ?? [])];
    if (rows.length === 0) return;
    void Promise.all(
      rows.map((thread) => setThreadDetail({ id: thread._id }, thread)),
    );
  }, [archivedThreads, setThreadDetail, unifiedThreads]);

  const pageShortcutMap = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(
        navItems
          .filter((item) => item.shortcut)
          .map((item) => [item.shortcut!.key.toLowerCase(), item.href]),
      ),
      ...Object.fromEntries(
        connectItems
          .filter((item) => item.shortcut)
          .map((item) => [item.shortcut!.key.toLowerCase(), item.href]),
      ),
      ...(canManageSettings ? { s: "/settings" } : {}),
      u: "/profile",
    }),
    [canManageSettings, connectItems, navItems],
  );

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const shortcutSequenceActiveRef = useRef(false);
  const shortcutSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<{
    open: boolean;
    primaryPolicyId: string;
    secondaryPolicyId: string;
    notificationId?: Id<"notifications">;
  }>({ open: false, primaryPolicyId: "", secondaryPolicyId: "" });
  const unreadCount = useCachedQuery(
    "notifications.unreadCount.sidebar",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).notifications.unreadCount,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as number | undefined;
  const conversations = useMemo(() => {
    return (unifiedThreads ?? []).slice(0, 8).map(
      (t): ConversationItem => ({
        kind:
          t.originChannel === "imessage" ||
          Boolean(t.threadPhone) ||
          t.title.startsWith("iMessage")
            ? "imessage"
            : t.originChannel === "email"
              ? "email"
              : "chat",
        id: t._id,
        label: t.title,
        time: t.lastMessageAt ?? t._creationTime,
      }),
    );
  }, [unifiedThreads]);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", next ? "1" : "");
    } catch {}
  }

  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleNewChat() {
    try {
      const threadId = await createThread({
        initialContext: pageContext ?? undefined,
        agentDomain: AGENT_DOMAIN,
        clientMutationId: createClientMutationId("thread"),
      });
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to create chat");
    }
  }

  async function handleArchiveThread(threadId: string, active: boolean) {
    await archiveThreadLocally(threadId as Id<"threads">);
    await archiveThread({ id: threadId as Id<"threads"> });
    if (!active) return;

    const next = conversations.find((c) => c.id !== threadId);
    if (next) {
      router.push(`/agent/thread/${next.id}`);
      return;
    }

    const nextThreadId = await createThread({
      agentDomain: AGENT_DOMAIN,
      clientMutationId: createClientMutationId("thread"),
    });
    router.push(`/agent/thread/${nextThreadId}`);
  }

  function handleMergeSuggestion(payload: MergeSuggestionPayload) {
    setMergeDialog({
      open: true,
      primaryPolicyId: payload.primaryPolicyId,
      secondaryPolicyId: payload.secondaryPolicyId,
      notificationId: payload.notificationId,
    });
  }

  useEffect(() => {
    function clearShortcutSequence() {
      shortcutSequenceActiveRef.current = false;
      if (shortcutSequenceTimerRef.current) {
        clearTimeout(shortcutSequenceTimerRef.current);
        shortcutSequenceTimerRef.current = null;
      }
    }

    function startShortcutSequence() {
      clearShortcutSequence();
      shortcutSequenceActiveRef.current = true;
      shortcutSequenceTimerRef.current = setTimeout(
        clearShortcutSequence,
        SHORTCUT_SEQUENCE_TIMEOUT_MS,
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (!shortcutSequenceActiveRef.current) {
        if (key === SHORTCUT_PREFIX_KEY) {
          e.preventDefault();
          startShortcutSequence();
        }
        return;
      }

      clearShortcutSequence();

      if (key === SHORTCUT_PREFIX_KEY) {
        e.preventDefault();
        startShortcutSequence();
        return;
      }

      const pageHref = pageShortcutMap[key];
      if (pageHref) {
        e.preventDefault();
        router.push(pageHref);
        return;
      }

      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9 && num <= conversations.length) {
        e.preventDefault();
        router.push(`/agent/thread/${conversations[num - 1].id}`);
      }
    }

    function handleBlur() {
      clearShortcutSequence();
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      clearShortcutSequence();
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [router, conversations, pageShortcutMap]);

  const headerBranding = sidebarHeaderBranding({
    viewerOrg,
    viewerName: viewer?.name,
    viewerEmail: viewer?.email,
  });
  const headerOrgName = headerBranding.name;
  const headerOrgIcon = headerBranding.iconUrl;
  const initials = getInitials(headerOrgName, viewer?.email);
  const brokerContact = viewerOrg?.brokerOrg ?? null;
  const fallbackAgentHandle = viewerOrg?.org?.agentHandle;

  const clientDetailBase = clientDetailId ? `/clients/${clientDetailId}` : "";
  const activeSettingsSection = searchParams.get("section") ?? "organization";

  function renderSettingsSidebarContent(contentCollapsed: boolean) {
    return (
      <SettingsSidebarContent
        collapsed={contentCollapsed}
        isBroker={isBroker}
        isStandaloneClient={isStandaloneClient}
        activeSettingsSection={activeSettingsSection}
        broker={brokerContact}
        fallbackAgentHandle={fallbackAgentHandle}
        showBrokerContact={!isBroker && !!viewerOrg}
        onToggleCollapse={toggleCollapse}
      />
    );
  }

  function renderSidebarContent(contentCollapsed: boolean) {
    return (
      <MainSidebarContent
        collapsed={contentCollapsed}
        isBroker={isBroker}
        canManageSettings={canManageSettings}
        pathname={pathname}
        headerOrgIcon={headerOrgIcon}
        viewerImage={viewer?.image}
        initials={initials}
        headerOrgName={headerOrgName}
        navItems={navItems}
        connectItems={connectItems}
        notificationsPanelOpen={notificationsPanelOpen}
        unreadCount={unreadCount}
        isDesktop={isDesktop}
        orgId={currentOrg?.orgId}
        conversations={conversations}
        archivedThreadCount={archivedThreads?.length ?? 0}
        broker={brokerContact}
        fallbackAgentHandle={fallbackAgentHandle}
        onToggleCollapse={toggleCollapse}
        onToggleNotifications={() => setNotificationsPanelOpen((v) => !v)}
        onCloseNotifications={() => setNotificationsPanelOpen(false)}
        onMergeSuggestion={handleMergeSuggestion}
        onAskGlass={onAskGlass}
        onNewChat={handleNewChat}
        onArchiveThread={handleArchiveThread}
        onSignOut={() => {
          clearOnboardingCache();
          signOut();
        }}
      />
    );
  }

  function renderClientDetailSidebarContent(contentCollapsed: boolean) {
    return (
      <ClientDetailSidebarContent
        collapsed={contentCollapsed}
        clientDetailBase={clientDetailBase}
        clientDetailId={clientDetailId}
        pathname={pathname}
        headerOrgIcon={headerOrgIcon}
        viewerImage={viewer?.image}
        initials={initials}
        headerOrgName={headerOrgName}
        clientThreads={clientThreads}
        onToggleCollapse={toggleCollapse}
      />
    );
  }

  function renderBaseActiveContent(contentCollapsed: boolean) {
    if (isClientDetailMode) {
      return renderClientDetailSidebarContent(contentCollapsed);
    }

    if (isSettingsMode) {
      return renderSettingsSidebarContent(contentCollapsed);
    }

    return renderSidebarContent(contentCollapsed);
  }

  const activeContent = renderBaseActiveContent(collapsed);
  const mobileActiveContent = renderBaseActiveContent(false);

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full border-r sidebar-transition ${
          collapsed ? "w-14" : "w-[220px]"
        } border-foreground/6 bg-background`}
      >
        {activeContent}
      </aside>

      {notificationsPanelOpen && isDesktop && currentOrg?.orgId && (
        <aside className="hidden h-full w-80 min-w-80 max-w-80 shrink-0 overflow-hidden lg:flex">
          <NotificationsPanel
            orgId={currentOrg.orgId}
            variant="pane"
            onClose={() => setNotificationsPanelOpen(false)}
            onMergeSuggestion={handleMergeSuggestion}
          />
        </aside>
      )}

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
              transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
              className="fixed left-0 top-0 bottom-0 w-[260px] z-50 border-r border-foreground/6 bg-background lg:hidden"
            >
              {mobileActiveContent}
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
