import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgAccessForQuery } from "./lib/access";
import {
  requirementEvaluationTargetLabel,
  requirementSemantics,
} from "./lib/requirementSemantics";
import { lobLabel, policyLobCodes } from "./lib/linesOfBusiness";

function policyLabel(policy: {
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
}) {
  const carrier = policy.mga || policy.carrier || policy.security || "Unknown carrier";
  const number = policy.policyNumber;
  return [carrier, number ? `#${number}` : undefined].filter(Boolean).join(" ");
}

export const list = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    if (!args.orgId) {
      return {
        policies: [],
        requirements: [],
        mailboxes: [],
      };
    }
    const orgId = args.orgId;
    const access = await getOrgAccessForQuery(ctx, orgId);
    if (!access) {
      return {
        policies: [],
        requirements: [],
        mailboxes: [],
      };
    }
    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const activeDocuments = allPolicies.filter(
      (policy) => policy.pipelineStatus === "complete" && !policy.deletedAt,
    );
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "active"),
      )
      .order("desc")
      .collect();

    const mailboxes =
      access.accessType === "member"
        ? (
            await ctx.db
              .query("connectedEmailAccounts")
              .withIndex("by_orgId_status", (q) =>
                q.eq("orgId", orgId).eq("status", "active"),
              )
              .collect()
          )
            .filter(
              (account) =>
                account.scope === "org" || account.userId === access.userId,
            )
            .map((account) => ({
              kind: "mailbox" as const,
              id: account._id,
              label: account.label || account.emailAddress,
              sublabel: account.label ? account.emailAddress : account.host,
            }))
        : [];

    return {
      policies: activeDocuments
        .map((policy) => ({
          kind: "policy" as const,
          id: policy._id,
          label: policyLabel(policy),
          sublabel: [
            policy.insuredName,
            policyLobCodes(policy).filter((code) => code !== "UN").map(lobLabel).join(", "),
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      requirements: requirements.map((requirement) => {
        const semantics = requirementSemantics(requirement);
        return {
          kind: "requirement" as const,
          id: requirement._id,
          label: requirement.title,
          sublabel: [
            requirement.appliesTo === "own_org"
              ? "My requirement"
              : requirement.appliesTo === "both"
                ? "My + vendor requirement"
                : "Vendor requirement",
            requirementEvaluationTargetLabel(semantics.evaluationTarget),
            requirement.category?.replace(/_/g, " "),
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }),
      mailboxes,
    };
  },
});
