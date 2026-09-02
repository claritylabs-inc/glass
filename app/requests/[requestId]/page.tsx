"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClientRequestDetail } from "@/components/procurement/client-requests-workspace";
import type { Id } from "@/convex/_generated/dataModel";

export default function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  return (
    <AppShell breadcrumbDetail="Request">
      <ClientRequestDetail requestId={requestId as Id<"procurementRequests">} />
    </AppShell>
  );
}
