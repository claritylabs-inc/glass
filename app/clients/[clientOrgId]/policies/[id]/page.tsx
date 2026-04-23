"use client";

import { use } from "react";
import { useClientDetailActions } from "../../layout";
import { PolicyDetailBody } from "@/app/policies/[id]/policy-detail-body";

export default function BrokerClientPolicyDetailPage({
  params,
}: {
  params: Promise<{ clientOrgId: string; id: string }>;
}) {
  const { clientOrgId, id } = use(params);
  const { setBreadcrumbExtra, setActions } = useClientDetailActions();

  return (
    <PolicyDetailBody
      id={id}
      onBreadcrumb={setBreadcrumbExtra}
      onActions={setActions}
      afterDeleteHref={`/clients/${clientOrgId}/policies`}
    />
  );
}
