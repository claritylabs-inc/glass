"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { ClientDocsList } from "@/components/client-docs-list";

export default function ClientQuotesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  if (!clientOrgId) return null;
  return (
    <ClientDocsList
      clientOrgId={clientOrgId as Id<"organizations">}
      documentType="quote"
    />
  );
}
