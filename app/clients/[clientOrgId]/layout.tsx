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

const NAV = [
  { id: "details", label: "Details", href: "" },
  { id: "applications", label: "Applications", href: "/applications" },
  { id: "policies", label: "Policies", href: "/policies" },
  { id: "quotes", label: "Quotes", href: "/quotes" },
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
  const currentOrg = useCurrentOrg();

  const clientOrg = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const baseHref = `/clients/${clientOrgId}`;

  function isActive(href: string) {
    const full = `${baseHref}${href}`;
    if (href === "")
      return pathname === baseHref || pathname === `${baseHref}/`;
    return pathname === full || pathname.startsWith(`${full}/`);
  }

  return (
    <AppShell breadcrumbDetail={clientOrg?.name ?? "Client"}>
      {clientOrg && currentOrg && (
        <ClientDetailHeader
          clientName={clientOrg.name}
          onboardingStatus={
            (clientOrg as { onboardingComplete?: boolean }).onboardingComplete
              ? "active"
              : "onboarding"
          }
        />
      )}

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav
          aria-label="Client sections"
          className="flex gap-1 overflow-x-auto scrollbar-hide md:flex-col md:overflow-visible"
        >
          {NAV.map((item) => (
            <Link
              key={item.id}
              href={`${baseHref}${item.href}`}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
