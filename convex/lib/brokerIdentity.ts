import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type BrokerIdentitySource =
  | "assignment"
  | "broker_default"
  | "manual"
  | "none";

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

function clean(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function applyOverrides(
  assignment: Doc<"brokerClientAssignments"> | null,
  user: Doc<"users"> | null,
) {
  return {
    contactName: clean(assignment?.contactNameOverride) ?? clean(user?.name),
    contactEmail: clean(assignment?.contactEmailOverride) ?? clean(user?.email),
    contactPhone: clean(assignment?.contactPhoneOverride) ?? clean(user?.phone),
  };
}

export async function resolveBrokerIdentityForClient(
  ctx: QueryCtx,
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
      const user = await ctx.db.get(assignment.producerId);
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

    if (brokerOrg.primaryInsuranceContactId) {
      const contactUser = await ctx.db.get(brokerOrg.primaryInsuranceContactId);
      return {
        clientOrgId: clientOrg._id,
        brokerOrgId: brokerOrg._id,
        brokerCompanyName: brokerOrg.name,
        contactUserId: contactUser?._id,
        contactName: clean(contactUser?.name),
        contactEmail: clean(contactUser?.email),
        contactPhone: clean(contactUser?.phone),
        source: "broker_default",
      };
    }

    return {
      clientOrgId: clientOrg._id,
      brokerOrgId: brokerOrg._id,
      brokerCompanyName: brokerOrg.name,
      source: "none",
    };
  }

  const brokerCompanyName = clean(clientOrg.brokerCompanyName);
  const contactName = clean(clientOrg.brokerContactName);
  const contactEmail = clean(clientOrg.brokerContactEmail);
  const contactPhone = clean(clientOrg.brokerContactPhone);
  const hasManualIdentity = !!(
    brokerCompanyName ||
    contactName ||
    contactEmail ||
    contactPhone
  );

  return {
    clientOrgId: clientOrg._id,
    brokerCompanyName,
    contactName,
    contactEmail,
    contactPhone,
    source: hasManualIdentity ? "manual" : "none",
  };
}
