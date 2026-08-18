import type { Id } from "../_generated/dataModel";

export const MAX_POLICY_CARDS_PER_TURN = 3;

export type ToolPolicyReference = {
  policyId: Id<"policies">;
  toolCallId: string;
  toolName: string;
};

export type PolicyCardSelection =
  | {
      ok: true;
      policyId: Id<"policies">;
    }
  | {
      ok: false;
      status:
        | "not_referenced"
        | "already_selected"
        | "recently_presented"
        | "multiple_not_requested"
        | "limit_reached";
      message: string;
    };

export function createAgentPolicyPresentationState() {
  const toolPolicyReferences: ToolPolicyReference[] = [];
  const presentedPolicyIds: Id<"policies">[] = [];

  return {
    toolPolicyReferences,
    presentedPolicyIds,
    recordToolPolicyReference(reference: ToolPolicyReference) {
      const exists = toolPolicyReferences.some(
        (candidate) =>
          String(candidate.policyId) === String(reference.policyId) &&
          candidate.toolCallId === reference.toolCallId &&
          candidate.toolName === reference.toolName,
      );
      if (!exists) toolPolicyReferences.push(reference);
    },
    selectPolicyCard(args: {
      policyId: string;
      allowMultiple: boolean;
      repeatRequested: boolean;
      wasRecentlyPresented: boolean;
    }): PolicyCardSelection {
      const reference = toolPolicyReferences.find(
        (candidate) => String(candidate.policyId) === args.policyId,
      );
      if (!reference) {
        return {
          ok: false,
          status: "not_referenced",
          message:
            "Resolve that exact policy with a policy tool in this turn before presenting its card.",
        };
      }

      if (
        presentedPolicyIds.some(
          (candidate) => String(candidate) === String(reference.policyId),
        )
      ) {
        return {
          ok: false,
          status: "already_selected",
          message: "That policy card is already selected for this response.",
        };
      }

      if (args.wasRecentlyPresented && !args.repeatRequested) {
        return {
          ok: false,
          status: "recently_presented",
          message:
            "That policy card was presented recently. Do not repeat it unless the user asks for it again.",
        };
      }

      if (presentedPolicyIds.length > 0 && !args.allowMultiple) {
        return {
          ok: false,
          status: "multiple_not_requested",
          message:
            "Only one policy card is allowed unless the user explicitly requests multiple policies or links.",
        };
      }

      if (presentedPolicyIds.length >= MAX_POLICY_CARDS_PER_TURN) {
        return {
          ok: false,
          status: "limit_reached",
          message: `A response can include at most ${MAX_POLICY_CARDS_PER_TURN} policy cards.`,
        };
      }

      presentedPolicyIds.push(reference.policyId);
      return { ok: true, policyId: reference.policyId };
    },
  };
}
