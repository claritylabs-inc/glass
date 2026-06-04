"use client";

import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OperationalDetailRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export default function ClientDetailsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const client = useCachedQuery(
    "clients.getDetail",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clients.getDetail,
    clientOrgId ? { clientOrgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  if (!client) return null;

  const rows: [string, string | undefined][] = [
    ["Company name", (client as { name?: string }).name],
    ["Legal name", (client as { legalName?: string }).legalName],
    ["Website", (client as { website?: string }).website],
    ["Industry", (client as { industry?: string }).industry],
    ["Context", (client as { context?: string }).context],
  ];
  const filled = rows.filter(([, v]) => v);

  return (
    <OperationalPanel as="div" className="px-5 py-1">
      {filled.length === 0 ? (
        <p className="py-3 text-base text-muted-foreground">
          No details yet.
        </p>
      ) : (
        filled.map(([label, value]) => (
          <OperationalDetailRow key={label} label={label} value={value} />
        ))
      )}
    </OperationalPanel>
  );
}
