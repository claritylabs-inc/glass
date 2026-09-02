import type { Metadata } from "next";
import { Packet } from "./packet";
import { loadPacket } from "./view";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Insurance submission packet", robots: { index: false, follow: false } };
}

export default async function PacketPage({ params }: PageProps) {
  const { token } = await params;
  return <Packet token={token} initialView={await loadPacket(token)} />;
}
