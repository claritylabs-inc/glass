import { ClientKanban } from "@/components/applications/client-kanban";
import { ClientApplicationShell } from "@/components/applications/client-application-shell";
import type { Id } from "@/convex/_generated/dataModel";

export default async function ApplicationOverviewPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  return (
    <ClientApplicationShell
      applicationId={applicationId as Id<"applications">}
      subtitle="Complete each section in order. Your broker will review and can request updates if needed."
    >
      <div className="rounded-2xl border border-foreground/10 bg-card p-5 sm:p-6">
        <ClientKanban applicationId={applicationId as Id<"applications">} />
      </div>
    </ClientApplicationShell>
  );
}
