"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-format";
import {
  useCachedOperatorCurrent,
  useCachedOperatorGlobalModelSettings,
} from "@/lib/sync/operator-cached-queries";
import { OperatorSidebar } from "../operator-sidebar";
import { ModelsTab } from "./models-tab";
import { RoutingTab, useRouterDashboard } from "./routing-tab";
import { ToolsTab } from "./tools-tab";
import { typeStyle } from "@/lib/typography";

const ROUTING_PAGE_TABS = ["routing", "models", "tools"] as const;
type RoutingPageTab = (typeof ROUTING_PAGE_TABS)[number];

function parseRoutingPageTab(value: string | null): RoutingPageTab {
  return ROUTING_PAGE_TABS.includes(value as RoutingPageTab)
    ? (value as RoutingPageTab)
    : "routing";
}

export default function OperatorRoutingPage() {
  const current = useCachedOperatorCurrent();
  const modelSettings = useCachedOperatorGlobalModelSettings() as
    | { updatedAt: number | null }
    | undefined;
  const {
    dashboard,
    loading,
    loadError,
    refresh,
    freezeLoading,
    setGlobalFreeze,
  } = useRouterDashboard();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseRoutingPageTab(searchParams.get("tab"));
  const selectTab = useCallback(
    (tab: RoutingPageTab) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === "routing") next.delete("tab");
      else next.set("tab", tab);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const actions =
    activeTab === "routing" ? (
      <PillButton
        variant="secondary"
        size="compact"
        disabled={loading}
        onClick={() => void refresh()}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Refresh
      </PillButton>
    ) : activeTab === "models" && modelSettings?.updatedAt ? (
      <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Updated {formatDisplayDate(modelSettings.updatedAt)}
      </span>
    ) : undefined;

  return (
    <AppShell
      actions={actions}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="routing"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      <main className="flex w-full flex-col">
        <Tabs
          value={activeTab}
          onValueChange={(value) => selectTab(parseRoutingPageTab(value))}
          className="gap-4"
        >
          <TabsList variant="pill" aria-label="Routing section">
            <TabsTrigger value="routing">Routing</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
          </TabsList>
          <TabsContent value="routing">
            <RoutingTab
              dashboard={dashboard}
              loading={loading}
              loadError={loadError}
              freezeLoading={freezeLoading}
              setGlobalFreeze={setGlobalFreeze}
            />
          </TabsContent>
          <TabsContent value="models">
            <ModelsTab />
          </TabsContent>
          <TabsContent value="tools">
            <ToolsTab />
          </TabsContent>
        </Tabs>
      </main>
    </AppShell>
  );
}
