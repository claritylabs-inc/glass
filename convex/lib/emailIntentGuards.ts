/**
 * Shared intent guards for agent email handoffs.
 *
 * Keep narrow channel-agnostic guards here when multiple agent entrypoints
 * need to make the same routing decision before calling the email expert.
 */
export function isBrokerDirectedEmailRequest(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    /\b(my|our|the)\s+broker\b/.test(normalized) &&
    /\b(send|email|e-mail|forward|share|draft)\b/.test(normalized)
  );
}
