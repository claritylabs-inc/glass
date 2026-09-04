import { Suspense } from "react";
import VendorRequestAcceptance from "./request-acceptance";
import { typeStyle } from "@/lib/typography";

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
          <div className={`text-gray-500 ${typeStyle("body.default")}`}>Loading request…</div>
        </div>
      }
    >
      <VendorRequestAcceptance token={token} />
    </Suspense>
  );
}
