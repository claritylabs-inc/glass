"use client";

import { useQuery } from "convex/react";
import { useParams, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { ClientDetailHeader } from "@/components/client-detail-header";
import { useCurrentOrg } from "@/hooks/use-current-org";
import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview", href: "" },
  { id: "passport", label: "Passport", href: "/passport" },
  { id: "applications", label: "Applications", href: "/applications" },
  { id: "policies", label: "Policies", href: "/policies" },
  { id: "intelligence", label: "Intelligence", href: "/intelligence" },
  { id: "activity", label: "Activity", href: "/activity" },
] as const;

export default function ClientDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const pathname = usePathname();
  const currentOrg = useCurrentOrg();

  const clientOrg = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const baseHref = `/clients/${clientOrgId}`;

  function isActiveTab(tabHref: string) {
    const fullHref = `${baseHref}${tabHref}`;
    if (tabHref === "") {
      return pathname === baseHref || pathname === `${baseHref}/`;
    }
    return pathname.startsWith(fullHref);
  }

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
          onboardingStatus={(clientOrg as { onboardingComplete?: boolean }).onboardingComplete ? "active" : "onboarding"}
          brokerOrgName={currentOrg.org.name}
        />
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`${baseHref}${tab.href}`}
            className={cn(
              "px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
              isActiveTab(tab.href)
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {children}
    </AppShell>
  );
}
