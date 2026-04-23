// app/invite/[token]/page.tsx
//
// Public page — no auth required to view.
// Shows broker branding, lets the visitor sign up (or log in) and accept the invite.

import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import InviteAcceptance from "./invite-acceptance";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  try {
    const result = await fetchAction(api.clientInvitations.getByToken, { token });
    const data = result as unknown as {
      brokerName?: string;
      brokerIconUrl?: string | null;
    } | null;
    if (!data?.brokerName) return { title: { absolute: "Invitation" } };
    const description = `Join ${data.brokerName} to manage your insurance and coverage.`;
    return {
      title: { absolute: data.brokerName },
      description,
      openGraph: {
        title: data.brokerName,
        siteName: data.brokerName,
        description,
      },
      twitter: {
        title: data.brokerName,
        description,
      },
      ...(data.brokerIconUrl ? { icons: { icon: data.brokerIconUrl } } : {}),
    };
  } catch {
    return { title: { absolute: "Invitation" } };
  }
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-sm text-gray-500">Loading invitation…</div>
        </div>
      }
    >
      <InviteAcceptance token={token} />
    </Suspense>
  );
}
