"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { AgentScope } from "./agentScope";

export const MAX_POLICY_FOCUS_IDS = 5;

type PolicyFocusMessage = {
  role: "user" | "agent" | "system";
  status?: string;
  referencedPolicyIds?: Array<Id<"policies"> | string>;
};

function uniquePolicyIds(
  ids: Array<Id<"policies"> | string>,
): Id<"policies">[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (id) unique.add(String(id));
    if (unique.size >= MAX_POLICY_FOCUS_IDS) break;
  }
  return [...unique] as Id<"policies">[];
}

export function selectPolicyFocusIds(
  messages: PolicyFocusMessage[],
  explicitPolicyIds: Array<Id<"policies"> | string> = [],
): Id<"policies">[] {
  if (explicitPolicyIds.length > 0) return uniquePolicyIds(explicitPolicyIds);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "system") continue;
    if (message.role !== "agent" || message.status !== undefined) return [];
    return uniquePolicyIds(message.referencedPolicyIds ?? []);
  }
  return [];
}

export async function validatePolicyFocusIds(
  ctx: ActionCtx,
  scope: AgentScope,
  policyIds: Id<"policies">[],
): Promise<Id<"policies">[]> {
  const readableOrgIds = new Set(scope.readOrgIds.map(String));
  const policies = await Promise.all(
    policyIds.slice(0, MAX_POLICY_FOCUS_IDS).map((id) =>
      ctx.runQuery(internal.policies.getInternal, { id }),
    ),
  );
  return policies
    .filter((policy) =>
      Boolean(
        policy &&
        !policy.deletedAt &&
        policy.orgId &&
        readableOrgIds.has(String(policy.orgId)),
      ),
    )
    .map((policy) => policy!._id);
}

export function formatPolicyFocusHints(policyIds: Id<"policies">[]): string {
  if (policyIds.length === 0) return "";
  return [
    "POLICY FOCUS HINTS (IDs only):",
    ...policyIds.map((policyId) => `- ${policyId}`),
    "These IDs identify the policies currently in focus, but contain no policy facts. Before using any policy term, date, limit, endorsement, party, or status, call lookup_policy with policyIds. Use lookup_policy_section for exact wording or evidence.",
  ].join("\n");
}
