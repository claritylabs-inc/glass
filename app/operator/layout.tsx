import { OperatorAgentProvider } from "@/components/operator-agent/operator-agent-provider";

export default function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <OperatorAgentProvider>{children}</OperatorAgentProvider>;
}
