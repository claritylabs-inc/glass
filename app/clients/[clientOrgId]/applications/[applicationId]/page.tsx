import { ReviewKanban } from "@/components/applications/review-kanban";
import { AppShell } from "@/components/app-shell";
import type { Id } from "@/convex/_generated/dataModel";

export default async function BrokerApplicationReviewPage({
  params,
}: {
  params: Promise<{ clientOrgId: string; applicationId: string }>;
}) {
  const { applicationId } = await params;
  return (
    <AppShell>
      <div className="max-w-7xl mx-auto py-8 px-4 h-full">
        <ReviewKanban applicationId={applicationId as Id<"applications">} />
      </div>
    </AppShell>
  );
}
