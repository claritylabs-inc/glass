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
  const whiteLabelingEnabled = broker.whiteLabelingEnabled !== false;
  const title = whiteLabelingEnabled ? broker.name : "Glass from Clarity Labs";
  const description = `Sign in to ${title}.`;
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      siteName: title,
      description,
    },
    twitter: {
      title,
      description,
    },
    ...(whiteLabelingEnabled && broker.iconUrl ? { icons: { icon: broker.iconUrl } } : {}),
  };
}

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
