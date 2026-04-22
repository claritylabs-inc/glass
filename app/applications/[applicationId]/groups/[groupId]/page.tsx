import { GroupFiller } from "@/components/applications/group-filler";
import { ClientApplicationShell } from "@/components/applications/client-application-shell";
import type { Id } from "@/convex/_generated/dataModel";

export default async function GroupFillerPage({
  params,
}: {
  params: Promise<{ applicationId: string; groupId: string }>;
}) {
  const { applicationId, groupId } = await params;
  return (
    <ClientApplicationShell
      applicationId={applicationId as Id<"applications">}
      currentGroupId={groupId as Id<"applicationGroups">}
      subtitle="Fill in this section with the most accurate and up-to-date information."
    >
      <GroupFiller
        applicationId={applicationId as Id<"applications">}
        groupId={groupId as Id<"applicationGroups">}
      />
    </ClientApplicationShell>
  );
}
