"use client";

import { type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BrandWordmark, PartnerWordmark } from "@/components/auth-shell";
import { LogoIcon } from "@/components/ui/logo-icon";
import type { Id } from "@/convex/_generated/dataModel";

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${
            i === current
              ? "h-1 w-4 sm:h-1.5 sm:w-6 bg-foreground"
              : i < current
              ? "h-1 w-1 sm:h-1.5 sm:w-1.5 bg-foreground/40"
              : "h-1 w-1 sm:h-1.5 sm:w-1.5 bg-foreground/15"
          }`}
        />
      ))}
    </div>
  );
}

export function ClientApplicationShell({
  applicationId,
  title,
  subtitle,
  currentGroupId,
  children,
}: {
  applicationId: Id<"applications">;
  title?: string;
  subtitle?: string;
  currentGroupId?: Id<"applicationGroups">;
  children: ReactNode;
}) {
  const data = useQuery((api as any).applications.get, { applicationId }) as {
    app: { title: string };
    groups: Array<{ _id: Id<"applicationGroups">; order: number }>;
  } | null | undefined;
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const brokerBrand = viewerOrg?.brokerOrg;

  const sortedGroups = [...(data?.groups ?? [])].sort((a, b) => a.order - b.order);
  const currentIndex = currentGroupId
    ? Math.max(0, sortedGroups.findIndex((g) => String(g._id) === String(currentGroupId)))
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="justify-self-start">
            <div className="sm:hidden">
              {brokerBrand ? (
                <PartnerWordmark
                  name={brokerBrand.name}
                  iconUrl={brokerBrand.iconUrl}
                  website={brokerBrand.website}
                />
              ) : (
                <LogoIcon size={18} color="#A0D2FA" static />
              )}
            </div>
            <div className="hidden sm:block">
              {brokerBrand ? (
                <PartnerWordmark
                  name={brokerBrand.name}
                  iconUrl={brokerBrand.iconUrl}
                  website={brokerBrand.website}
                />
              ) : (
                <BrandWordmark />
              )}
            </div>
          </div>
          <div className="justify-self-center">
            {sortedGroups.length > 0 ? (
              <StepBar current={currentIndex} total={sortedGroups.length} />
            ) : null}
          </div>
          <div className="justify-self-end text-sm text-muted-foreground">
            {viewer?.email ?? ""}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        <div className="w-full max-w-3xl space-y-8">
          <div className="space-y-3 text-left">
            <h1 className="text-base font-medium tracking-tight">{title ?? data?.app?.title ?? "Application"}</h1>
            {subtitle ? <p className="text-base text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
