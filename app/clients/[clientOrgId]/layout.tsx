"use client";

import { useQuery } from "convex/react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { ClientDetailHeader } from "@/components/client-detail-header";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "details", label: "Details", href: "" },
  { id: "applications", label: "Applications", href: "/applications" },
  { id: "policies", label: "Policies", href: "/policies" },
  { id: "intelligence", label: "Intelligence", href: "/intelligence" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "settings", label: "Settings", href: "/settings" },
] as const;

export default function ClientDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const currentOrg = useCurrentOrg();

  const clientOrg = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const baseHref = `/clients/${clientOrgId}`;

  const activeTab =
    TABS.find((t) => {
      const full = `${baseHref}${t.href}`;
      if (t.href === "") return pathname === baseHref || pathname === `${baseHref}/`;
      return pathname.startsWith(full);
    })?.id ?? "details";

  const firstMembership = useQuery(
    api.orgs.listMembersForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const primaryContact = firstMembership?.[0];

  return (
    <AppShell breadcrumbDetail={clientOrg?.name ?? "Client"}>
      {clientOrg && currentOrg && (
        <ClientDetailHeader
          clientName={clientOrg.name}
          primaryContactName={primaryContact?.name}
          primaryContactEmail={primaryContact?.email}
          onboardingStatus={
            (clientOrg as { onboardingComplete?: boolean }).onboardingComplete
              ? "active"
              : "onboarding"
          }
          brokerOrgName={currentOrg.org.name}
        />
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          const tab = TABS.find((t) => t.id === v);
          if (tab) router.push(`${baseHref}${tab.href}`);
        }}
        className="mb-6"
      >
        <TabsList variant="pill" className="flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </AppShell>
  );
}
