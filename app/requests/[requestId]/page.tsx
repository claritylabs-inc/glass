"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClientRequestDetail } from "@/components/procurement/client-requests-workspace";
import type { Id } from "@/convex/_generated/dataModel";

export default function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null);
  const handleBreadcrumb = useCallback(
    (detail: string | null) => setBreadcrumb(detail),
    [],
  );

  return (
    <AppShell breadcrumbDetail={breadcrumb ?? "Request"}>
      <ClientRequestDetail
        requestId={requestId as Id<"procurementRequests">}
        onBreadcrumb={handleBreadcrumb}
      />
    </AppShell>
  );
}
