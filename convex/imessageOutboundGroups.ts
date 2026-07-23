import dayjs from "dayjs";
import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";
import {
  buildImessageGroupMemberTitle,
  normalizeImessageAddress,
  resolveImessageConversationScope,
  type ResolvedImessageParticipant,
} from "./lib/imessageGroupResolution";
import { resolveBrokerIdentityForClient } from "./lib/brokerIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7;
}

function normalizedToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchesPerson(user: Doc<"users"> | null, token: string): boolean {
  if (!user) return false;
  const normalized = normalizedToken(token);
  if (!normalized) return false;
  return [user.name, user.email, user.title]
    .filter(Boolean)
    .some((value) => normalizedToken(value!).includes(normalized));
}

function matchesOrg(org: Doc<"organizations"> | null, token: string): boolean {
  if (!org) return false;
  const normalized = normalizedToken(token);
  if (!normalized) return false;
  return [org.name, org.website, org.primaryContactName, org.primaryContactEmail]
    .filter(Boolean)
    .some((value) => normalizedToken(value!).includes(normalized));
}

async function listOrgUsers(ctx: any, orgId: Id<"organizations">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId", (q: any) => q.eq("orgId", orgId))
    .collect();
  const rows = await Promise.all(
    memberships.map(async (membership: Doc<"orgMemberships">) => ({
      membership,
      user: await ctx.db.get(membership.userId),
    })),
  );
  return rows.filter((row) => !!row.user);
}

async function firstContactForOrg(ctx: any, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org) return null;
  if (org.primaryInsuranceContactId) {
    const user = await ctx.db.get(org.primaryInsuranceContactId);
    if (user?.phone) return { org, user };
  }
  const users = await listOrgUsers(ctx, orgId);
  const admin = users.find((row) => row.membership.role === "admin" && row.user?.phone);
  const fallback = admin ?? users.find((row) => row.user?.phone);
  return fallback?.user ? { org, user: fallback.user } : null;
}

async function brokerContactForClient(ctx: any, clientOrg: Doc<"organizations">) {
  if (!clientOrg.brokerOrgId) return null;
  const brokerIdentity = await resolveBrokerIdentityForClient(ctx, clientOrg);
  if (brokerIdentity.brokerOrgId && brokerIdentity.contactUserId && brokerIdentity.contactPhone) {
    const [brokerOrg, contactUser] = await Promise.all([
      ctx.db.get(brokerIdentity.brokerOrgId),
      ctx.db.get(brokerIdentity.contactUserId),
    ]);
    if (brokerOrg && contactUser) {
      return {
        org: brokerOrg,
        user: {
          ...contactUser,
          name: brokerIdentity.contactName ?? contactUser.name,
          email: brokerIdentity.contactEmail ?? contactUser.email,
          phone: brokerIdentity.contactPhone,
        },
      };
    }
  }
  return await firstContactForOrg(ctx, clientOrg.brokerOrgId);
}

function participantFromUser(params: {
  user: Doc<"users">;
  orgId: Id<"organizations">;
  displayName?: string;
}): ResolvedImessageParticipant | null {
  if (!params.user.phone) return null;
  return {
    address: normalizeImessageAddress(params.user.phone),
    displayName: params.displayName ?? params.user.name ?? params.user.email,
    userId: params.user._id,
    userName: params.user.name,
    userEmail: params.user.email,
    orgId: params.orgId,
    role: "linked",
  };
}

function participantFromPhone(raw: string): ResolvedImessageParticipant {
  return {
    address: normalizeImessageAddress(raw),
    displayName: raw.trim(),
    role: "anonymous",
  };
}

export const resolveRecipients = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    recipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    const user = await ctx.db.get(args.userId);
    if (!org || !user) throw new Error("Organization or user not found");
    if (!user.phone) {
      return {
        ok: false,
        reason: "Your profile needs a phone number before Glass can start an iMessage group.",
        participants: [],
        unresolved: args.recipients,
      };
    }

    const participants = new Map<string, ResolvedImessageParticipant>();
    const unresolved: string[] = [];
    const ambiguous: Array<{ input: string; matches: string[] }> = [];
    const addParticipant = (participant: ResolvedImessageParticipant | null) => {
      if (!participant) return;
      const address = normalizeImessageAddress(participant.address);
      participants.set(address, { ...participant, address });
    };

    addParticipant(participantFromUser({ user, orgId: args.orgId, displayName: user.name ?? "You" }));

    const team = await listOrgUsers(ctx, args.orgId);
    const relatedOrgs: Array<{ org: Doc<"organizations">; kind: "broker" | "client" | "vendor" }> = [];
    if (org.brokerOrgId) {
      const broker = await ctx.db.get(org.brokerOrgId);
      if (broker) relatedOrgs.push({ org: broker, kind: "broker" });
    }
    const clientOrgs = org.type === "broker"
      ? await ctx.db
          .query("organizations")
          .withIndex("by_brokerOrgId", (q: any) => q.eq("brokerOrgId", args.orgId))
          .collect()
      : [];
    for (const clientOrg of clientOrgs) relatedOrgs.push({ org: clientOrg, kind: "client" });
    const vendorRelationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q: any) =>
        q.eq("clientOrgId", args.orgId).eq("status", "active"),
      )
      .collect();
    for (const relationship of vendorRelationships) {
      const vendorOrg = await ctx.db.get(relationship.vendorOrgId);
      if (vendorOrg) relatedOrgs.push({ org: vendorOrg, kind: "vendor" });
    }

    for (const rawRecipient of args.recipients) {
      const recipient = rawRecipient.trim();
      if (!recipient) continue;
      if (looksLikePhone(recipient)) {
        addParticipant(participantFromPhone(recipient));
        continue;
      }

      const normalized = normalizedToken(recipient);
      if (normalized === "me" || normalized === "myself") continue;

      if (normalized === "broker" || normalized === "my broker") {
        const contact = await brokerContactForClient(ctx, org);
        if (contact?.user) {
          addParticipant(participantFromUser({
            user: contact.user,
            orgId: contact.org._id,
            displayName: contact.user.name ?? `${contact.org.name} broker`,
          }));
        } else {
          unresolved.push(recipient);
        }
        continue;
      }

      const personMatches: ResolvedImessageParticipant[] = [];
      for (const row of team) {
        if (matchesPerson(row.user, recipient)) {
          personMatches.push(participantFromUser({ user: row.user!, orgId: args.orgId })!);
        }
      }

      for (const related of relatedOrgs) {
        if (matchesOrg(related.org, recipient) || normalized === related.kind || normalized === `my ${related.kind}`) {
          const contact = related.kind === "broker"
            ? await brokerContactForClient(ctx, org)
            : await firstContactForOrg(ctx, related.org._id);
          if (contact?.user) {
            personMatches.push(participantFromUser({
              user: contact.user,
              orgId: contact.org._id,
              displayName: contact.user.name ?? contact.org.name,
            })!);
          }
        }
        const relatedUsers = await listOrgUsers(ctx, related.org._id);
        for (const row of relatedUsers) {
          if (matchesPerson(row.user, recipient)) {
            personMatches.push(participantFromUser({ user: row.user!, orgId: related.org._id })!);
          }
        }
      }

      const validMatches = personMatches.filter(Boolean);
      const uniqueByAddress = new Map(validMatches.map((match) => [match.address, match]));
      if (uniqueByAddress.size === 1) {
        addParticipant([...uniqueByAddress.values()][0]!);
      } else if (uniqueByAddress.size > 1) {
        ambiguous.push({
          input: recipient,
          matches: [...uniqueByAddress.values()].map(
            (match) => match.userName ?? match.displayName ?? match.address,
          ),
        });
      } else {
        unresolved.push(recipient);
      }
    }

    const resolvedParticipants = [...participants.values()];
    const scope = resolveImessageConversationScope({
      senderAddress: normalizeImessageAddress(user.phone),
      participants: resolvedParticipants,
    });
    const title = buildImessageGroupMemberTitle(resolvedParticipants);
    return {
      ok: unresolved.length === 0 && ambiguous.length === 0 && resolvedParticipants.length >= 2,
      reason:
        resolvedParticipants.length < 2
          ? "At least one other person with a phone number is required."
          : undefined,
      participants: resolvedParticipants,
      unresolved,
      ambiguous,
      scopeKind: scope.kind === "no_linked_users" ? "single_org" : scope.kind,
      primaryOrgId: scope.primaryOrgId ?? args.orgId,
      title,
    };
  },
});

export const setPrimaryBrokerContactForClient = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    producerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg?.brokerOrgId) throw new Error("Client is not connected to a broker org");
    const brokerAccess = await getOrgAccess(ctx, clientOrg.brokerOrgId);
    if (brokerAccess.accessType !== "member" || brokerAccess.role !== "admin") {
      throwUserFacingError(userFacingErrorCodes.brokerAdminRequired);
    }
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", clientOrg.brokerOrgId!).eq("userId", args.producerId),
      )
      .first();
    if (!membership) throw new Error("Producer must be a broker org member");

    const assignments = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_orgId_clientOrgId", (q) =>
        q.eq("orgId", clientOrg.brokerOrgId!).eq("clientOrgId", args.clientOrgId),
      )
      .collect();
    for (const assignment of assignments) {
      await ctx.db.patch(assignment._id, {
        role: assignment.producerId === args.producerId ? "primary" : "secondary",
      });
    }
    if (!assignments.some((assignment) => assignment.producerId === args.producerId)) {
      await ctx.db.insert("brokerClientAssignments", {
        orgId: clientOrg.brokerOrgId,
        clientOrgId: args.clientOrgId,
        producerId: args.producerId,
        role: "primary",
        createdAt: dayjs().valueOf(),
      });
    }
  },
});
