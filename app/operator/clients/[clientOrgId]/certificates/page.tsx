import { redirect } from "next/navigation";

export default async function OperatorClientCertificatesPage({
  params,
}: {
  params: Promise<{ clientOrgId: string }>;
}) {
  const { clientOrgId } = await params;
  redirect(`/operator/clients/${clientOrgId}/compliance?tab=certificates`);
}
