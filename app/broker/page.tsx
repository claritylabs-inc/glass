import { AppShell } from "@/components/app-shell";
import { BrokerProfileWorkspace } from "@/components/broker-profile-workspace";

export default function BrokerPage() {
  return (
    <AppShell disablePersistentChat disableCommandPalette>
      <BrokerProfileWorkspace />
    </AppShell>
  );
}
