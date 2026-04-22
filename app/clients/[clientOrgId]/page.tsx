"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function ClientDetailsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const org = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  if (!org) return null;

  const rows: [string, string | undefined][] = [
    ["Company name", org.name],
    ["Website", (org as { website?: string }).website],
    ["Industry", (org as { industry?: string }).industry],
    ["Context", (org as { context?: string }).context],
  ];
  const filled = rows.filter(([, v]) => v);

  return (
    <div className="rounded-lg border border-foreground/6 bg-card divide-y divide-foreground/6">
      {filled.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          No details yet.
        </p>
      ) : (
        filled.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <dt className="text-label-sm font-medium text-muted-foreground sm:w-40 shrink-0">
              {label}
            </dt>
            <dd className="text-sm text-foreground">{value}</dd>
          </div>
        ))
      )}
    </div>
  );
}
