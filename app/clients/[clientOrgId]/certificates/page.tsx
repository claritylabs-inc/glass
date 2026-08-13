"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

import {
  CertificatesWorkspace,
  type CertificatesWorkspaceShellArgs,
} from "@/components/certificates/certificates-workspace";
import type { Id } from "@/convex/_generated/dataModel";
import { useClientDetailActions } from "../layout";

function ManagedClientCertificatesShell({
  actions,
  rightPanel,
  toolbar,
  children,
}: CertificatesWorkspaceShellArgs) {
  const {
    setActions,
    setRightPanel,
    setBreadcrumbExtra,
  } = useClientDetailActions();

  useEffect(() => {
    setBreadcrumbExtra("Certificates");
    return () => setBreadcrumbExtra(null);
  }, [setBreadcrumbExtra]);

  useEffect(() => {
    setActions(actions);
    return () => setActions(null);
  }, [actions, setActions]);

  useEffect(() => {
    setRightPanel(rightPanel);
    return () => setRightPanel(null);
  }, [rightPanel, setRightPanel]);

  return (
    <main className="w-full space-y-6">
      <div className="overflow-x-auto">{toolbar}</div>
      {children}
    </main>
  );
}

export default function ManagedClientCertificatesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  return (
    <CertificatesWorkspace
      orgId={clientOrgId as Id<"organizations">}
      policyHref={(policyId) => `/clients/${clientOrgId}/policies/${policyId}`}
      renderShell={(args: CertificatesWorkspaceShellArgs) => (
        <ManagedClientCertificatesShell {...args} />
      )}
    />
  );
}
