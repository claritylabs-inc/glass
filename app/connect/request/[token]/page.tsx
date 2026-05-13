import { Suspense } from "react";
import VendorRequestAcceptance from "@/app/connected-orgs/request/[token]/request-acceptance";

export default async function ConnectRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-sm text-gray-500">Loading request…</div>
        </div>
      }
    >
      <VendorRequestAcceptance token={token} />
    </Suspense>
  );
}
