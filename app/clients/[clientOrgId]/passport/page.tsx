"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function ClientPassportPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const org = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
        Passport — read-only preview (v1)
      </p>
      {org ? (
        <dl className="space-y-2">
          {(
            [
              ["Company name", org.name],
              ["Website", (org as { website?: string }).website],
              ["Industry", (org as { industry?: string }).industry],
              ["Context", (org as { context?: string }).context],
            ] as [string, string | undefined][]
          ).map(([label, value]) =>
            value ? (
              <div key={label} className="flex gap-3">
                <dt className="text-sm font-medium w-36 shrink-0 text-muted-foreground">
                  {label}
                </dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      <p className="text-xs text-muted-foreground pt-4 border-t">
        Full passport editor arrives in Subsystem 3.
      </p>
    </div>
  );
}
