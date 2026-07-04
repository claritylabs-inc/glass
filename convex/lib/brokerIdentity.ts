import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type BrokerIdentitySource = "assignment" | "none";

export type BrokerIdentity = {
  clientOrgId: Id<"organizations">;
  brokerOrgId?: Id<"organizations">;
  brokerCompanyName?: string;
  contactUserId?: Id<"users">;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  source: BrokerIdentitySource;
  assignmentId?: Id<"brokerClientAssignments">;
};

type BrokerIdentityCtx = Pick<QueryCtx, "db">;

function clean(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeOptionalEmail(
  value: string | undefined | null,
  options?: { strict?: boolean },
) {
  const cleaned = clean(value)?.toLowerCase();
  if (!cleaned) return undefined;
  if (!EMAIL_PATTERN.test(cleaned)) {
    if (!options?.strict) return undefined;
    throw new Error("Enter a valid broker email address");
  }
  return cleaned;
}

function applyOverrides(
  assignment: Doc<"brokerClientAssignments"> | null,
  user: Doc<"users"> | null,
) {
  return {
    contactName: clean(assignment?.contactName) ?? clean(user?.name),
    contactEmail:
      normalizeOptionalEmail(assignment?.contactEmail) ??
      normalizeOptionalEmail(user?.email),
    contactPhone: clean(assignment?.contactPhone) ?? clean(user?.phone),
  };
}

export async function resolveBrokerIdentityForClient(
  ctx: BrokerIdentityCtx,
  clientOrg: Doc<"organizations">,
): Promise<BrokerIdentity> {
  if ((clientOrg.type ?? "client") !== "client") {
    return {
      clientOrgId: clientOrg._id,
      source: "none",
    };
  }

  if (clientOrg.brokerOrgId) {
    const brokerOrg = await ctx.db.get(clientOrg.brokerOrgId);
    if (!brokerOrg) {
      return {
        clientOrgId: clientOrg._id,
        brokerOrgId: clientOrg.brokerOrgId,
        source: "none",
      };
    }

    const assignments = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_orgId_clientOrgId", (q) =>
        q.eq("orgId", clientOrg.brokerOrgId!).eq("clientOrgId", clientOrg._id),
      )
      .collect();
    const assignment =
      assignments.find((row) => row.role === "primary") ?? assignments[0] ?? null;

    if (assignment) {
      const user = assignment.producerId ? await ctx.db.get(assignment.producerId) : null;
      return {
        clientOrgId: clientOrg._id,
        brokerOrgId: brokerOrg._id,
        brokerCompanyName: brokerOrg.name,
        contactUserId: assignment.producerId,
        ...applyOverrides(assignment, user),
        source: "assignment",
        assignmentId: assignment._id,
      };
    }

    return {
      clientOrgId: clientOrg._id,
      brokerOrgId: brokerOrg._id,
      brokerCompanyName: brokerOrg.name,
      source: "none",
    };
  }

  return {
    clientOrgId: clientOrg._id,
    source: "none",
  };
}
