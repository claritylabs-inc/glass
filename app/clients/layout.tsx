import { ClientWorkspaceShell } from "./client-workspace-shell";

export default function ClientsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientWorkspaceShell>{children}</ClientWorkspaceShell>;
}
