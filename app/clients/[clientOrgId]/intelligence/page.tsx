"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

const CATEGORY_LABELS: Record<string, string> = {
  company_info: "Company",
  operations: "Operations",
  financial: "Financial",
  coverage: "Coverage",
  risk: "Risk",
  relationship: "Relationship",
  observation: "Observation",
  products_services: "Products",
  employees: "Employees",
  insurance: "Insurance",
  clients: "Clients",
  investors: "Investors",
  vendors: "Vendors",
  partners: "Partners",
};

export default function ClientIntelligencePage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const entries = useQuery(
    api.intelligence.listForBroker,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
        Intelligence — broker-filtered view
      </p>
      <div className="space-y-2">
        {entries === undefined ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground/60">Loading…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground/60">
              No intelligence entries yet.
            </p>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e._id} className="rounded-md border bg-card px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[e.category] ?? e.category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(e as { sourceLabel?: string }).sourceLabel ?? e.source}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm">{e.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
