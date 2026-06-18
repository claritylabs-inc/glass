"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

import { ApplicationIntakePage } from "@/components/application-intake/application-intake-page";
import { useClientDetailActions } from "../layout";

export default function ClientApplicationsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const { setActions, setBreadcrumbExtra, setRightPanel } = useClientDetailActions();

  useEffect(() => {
    setBreadcrumbExtra("Applications");
    return () => setBreadcrumbExtra(null);
  }, [setBreadcrumbExtra]);

  return (
    <ApplicationIntakePage
      mode="client"
      clientOrgId={clientOrgId}
      onActionsChange={setActions}
      onRightPanelChange={setRightPanel}
    />
  );
}
