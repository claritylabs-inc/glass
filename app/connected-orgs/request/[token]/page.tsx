import { redirect } from "next/navigation";

export default async function ConnectedOrgRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/connect/request/${token}`);
}
