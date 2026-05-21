import { AppShell } from "@/components/app-shell";
import { PolicyDetailSkeleton } from "./policy-detail-skeleton";

export default function PolicyDetailLoading() {
  return (
    <AppShell>
      <PolicyDetailSkeleton />
    </AppShell>
  );
}
