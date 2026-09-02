import { AppShell } from "@/components/app-shell";
import { ClientRequestsList } from "@/components/procurement/client-requests-workspace";

export default function RequestsPage() {
  return (
    <AppShell>
      <ClientRequestsList />
    </AppShell>
  );
}
