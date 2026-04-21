// app/invite/[token]/page.tsx
//
// Public page — no auth required to view.
// Shows broker branding, lets the visitor sign up (or log in) and accept the invite.

import { Suspense } from "react";
import InviteAcceptance from "./invite-acceptance";

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
