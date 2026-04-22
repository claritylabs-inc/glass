import { ReviewKanban } from "@/components/applications/review-kanban";
import type { Id } from "@/convex/_generated/dataModel";

export default async function BrokerApplicationReviewPage({
  params,
}: {
  params: Promise<{ clientOrgId: string; applicationId: string }>;
}) {
  const { applicationId } = await params;
  return (
    <div className="py-2 h-full">
      <ReviewKanban applicationId={applicationId as Id<"applications">} />
    </div>
  );
}
