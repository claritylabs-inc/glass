import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { BrokerAuthEntryPage } from "@/components/broker-auth-entry-page";

export default async function BrokerLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const broker = await fetchQuery(api.orgs.publicBrokerBySlug, { slug });
  if (!broker) notFound();
  return <BrokerAuthEntryPage broker={broker} mode="login" />;
}
