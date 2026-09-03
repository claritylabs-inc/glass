import { redirect } from "next/navigation";

/** The company wiki lived at /memory before the rename. */
export default async function OperatorClientMemoryRedirect({
  params,
}: {
  params: Promise<{ clientOrgId: string }>;
}) {
  const { clientOrgId } = await params;
  redirect(`/operator/clients/${clientOrgId}/wiki`);
}
