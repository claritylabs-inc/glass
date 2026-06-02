import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgAccessForQuery } from "./lib/access";

function policyLabel(policy: {
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  quoteNumber?: string;
  insuredName?: string;
  documentType?: string;
}) {
  const carrier = policy.mga || policy.carrier || policy.security || "Unknown carrier";
  const number =
    policy.documentType === "quote"
      ? policy.quoteNumber || policy.policyNumber
      : policy.policyNumber;
  return [carrier, number ? `#${number}` : undefined].filter(Boolean).join(" ");
}

export const list = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    if (!args.orgId) {
      return {
        policies: [],
        quotes: [],
        requirements: [],
        mailboxes: [],
      };
    }
    const orgId = args.orgId;
    const access = await getOrgAccessForQuery(ctx, orgId);
    if (!access) {
      return {
        policies: [],
        quotes: [],
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
        .filter((policy) => policy.documentType !== "quote")
        .map((policy) => ({
          kind: "policy" as const,
          id: policy._id,
          label: policyLabel(policy),
          sublabel: [policy.insuredName, policy.policyTypes?.join(", ")]
            .filter(Boolean)
            .join(" · "),
        })),
      quotes: activeDocuments
        .filter((policy) => policy.documentType === "quote")
        .map((quote) => ({
          kind: "quote" as const,
          id: quote._id,
          label: policyLabel(quote),
          sublabel: [quote.insuredName, quote.premium].filter(Boolean).join(" · "),
        })),
      requirements: requirements.map((requirement) => ({
        kind: "requirement" as const,
        id: requirement._id,
        label: requirement.title,
        sublabel: [
          requirement.appliesTo === "own_org"
            ? "Internal"
            : requirement.appliesTo === "both"
              ? "Internal + vendor"
              : "Vendor",
          requirement.category?.replace(/_/g, " "),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      mailboxes,
    };
  },
});
