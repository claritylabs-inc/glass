import { ClientKanban } from "@/components/applications/client-kanban";
import { AppShell } from "@/components/app-shell";
import type { Id } from "@/convex/_generated/dataModel";

export default async function ApplicationOverviewPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  return (
    <AppShell>
      <div className="max-w-6xl mx-auto py-8 px-4">
        <ClientKanban applicationId={applicationId as Id<"applications">} />
      </div>
    </AppShell>
  );
}
