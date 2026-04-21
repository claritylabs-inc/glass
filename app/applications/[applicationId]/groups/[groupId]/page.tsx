import { GroupFiller } from "@/components/applications/group-filler";
import { AppShell } from "@/components/app-shell";
import type { Id } from "@/convex/_generated/dataModel";

export default async function GroupFillerPage({
  params,
}: {
  params: Promise<{ applicationId: string; groupId: string }>;
}) {
  const { applicationId, groupId } = await params;
  return (
    <AppShell>
      <GroupFiller
        applicationId={applicationId as Id<"applications">}
        groupId={groupId as Id<"applicationGroups">}
      />
    </AppShell>
  );
}
