"use client";

import { use, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PolicyDetailBody } from "./policy-detail-body";

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);

  return (
    <AppShell breadcrumbDetail={breadcrumb} actions={actions}>
      <PolicyDetailBody
        id={id}
        onBreadcrumb={setBreadcrumb}
        onActions={setActions}
        afterDeleteHref="/policies"
      />
    </AppShell>
  );
}
