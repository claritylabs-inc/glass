import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { BrokerAuthEntryPage } from "@/components/broker-auth-entry-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const broker = await fetchQuery(api.orgs.publicBrokerBySlug, { slug }).catch(() => null);
  if (!broker) return {};
  const description = `Join ${broker.name} to manage your insurance and coverage.`;
  return {
    title: { absolute: broker.name },
    description,
    openGraph: {
      title: broker.name,
      siteName: broker.name,
      description,
    },
    twitter: {
      title: broker.name,
      description,
    },
    ...(broker.iconUrl ? { icons: { icon: broker.iconUrl } } : {}),
  };
}

export default async function BrokerSignupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const broker = await fetchQuery(api.orgs.publicBrokerBySlug, { slug });
  if (!broker) notFound();
  return <BrokerAuthEntryPage broker={broker} mode="signup" />;
}
