/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { getClientSupportDetails, updateClientSettings } from "./operator";
import {
  listInvitations,
  listMembers,
  removeMember,
  requestMemberEmailChange,
  sendMemberInvitation,
  setPrimaryInsuranceContact,
  updateMemberProfile,
  updateMemberRole,
  updateOrganizationProfile,
} from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const getClientSupportDetailsFn = getClientSupportDetails as any;
const updateClientSettingsFn = updateClientSettings as any;
const listInvitationsFn = listInvitations as any;
const listMembersFn = listMembers as any;
const removeMemberFn = removeMember as any;
const requestMemberEmailChangeFn = requestMemberEmailChange as any;
const sendMemberInvitationFn = sendMemberInvitation as any;
const setPrimaryInsuranceContactFn = setPrimaryInsuranceContact as any;
const updateMemberProfileFn = updateMemberProfile as any;
const updateMemberRoleFn = updateMemberRole as any;
const updateOrganizationProfileFn = updateOrganizationProfile as any;

async function seedSupportFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Support Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const adminUserId = await ctx.db.insert("users", {
      name: "Client Admin",
      email: "admin@example.com",
      accountKind: "customer",
    });
    const memberUserId = await ctx.db.insert("users", {
      name: "Client Member",
      email: "member@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Original Client",
      type: "client",
      operatorStatus: "live",
      primaryInsuranceContactId: adminUserId,
    });
    const adminMembershipId = await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: adminUserId,
      role: "admin",
    });
    const memberMembershipId = await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: memberUserId,
      role: "member",
    });
    const invitationId = await ctx.db.insert("orgInvitations", {
      orgId: clientOrgId,
      email: "pending@example.com",
      role: "member",
      invitedBy: adminUserId,
      status: "pending",
      expiresAt: dayjs(now).add(7, "day").valueOf(),
    });
    return {
      operatorUserId,
      adminUserId,
      memberUserId,
      clientOrgId,
      adminMembershipId,
      memberMembershipId,
      invitationId,
    };
  });
  return { t, ...ids };
}

describe("operator client support", () => {
  test("edits critical organization and team fields through explicit audited scope", async () => {
    const fixture = await seedSupportFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await operator.mutation(updateClientSettingsFn, {
      clientOrgId: fixture.clientOrgId,
      name: "Supported Client",
      website: "https://supported.example.com",
      industry: "professional_services",
      industryVertical: "consulting",
      relatedLegalEntities: [{ legalName: "Supported Client Holdings LLC" }],
      primaryContactName: "Client Admin",
      primaryContactEmail: "admin@example.com",
    });
    await operator.mutation(updateOrganizationProfileFn, {
      operatorClientOrgId: fixture.clientOrgId,
      profile: {
        mailingAddress: {
          street1: "123 Main St",
          city: "New York",
          state: "NY",
          zip: "10001",
          country: "US",
        },
        entityType: "limited_liability_company",
        fein: "12-3456789",
        businessNumber: "",
        operationsDescription: "Technology consulting services",
      },
    });
    await operator.mutation(updateMemberProfileFn, {
      operatorClientOrgId: fixture.clientOrgId,
      membershipId: fixture.memberMembershipId,
      name: "Support Updated",
      title: "Risk Manager",
    });
    await operator.mutation(updateMemberRoleFn, {
      operatorClientOrgId: fixture.clientOrgId,
      membershipId: fixture.memberMembershipId,
      role: "admin",
    });
    await operator.mutation(setPrimaryInsuranceContactFn, {
      operatorClientOrgId: fixture.clientOrgId,
      userId: fixture.memberUserId,
    });
    await operator.mutation(removeMemberFn, {
      operatorClientOrgId: fixture.clientOrgId,
      membershipId: fixture.adminMembershipId,
    });

    const details = await operator.query(getClientSupportDetailsFn, {
      clientOrgId: fixture.clientOrgId,
    });
    const members = await operator.query(listMembersFn, {
      operatorClientOrgId: fixture.clientOrgId,
    });
    const invitations = await operator.query(listInvitationsFn, {
      operatorClientOrgId: fixture.clientOrgId,
    });
    const audits = await fixture.t.run((ctx) =>
      ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_targetOrgId_createdAt", (q) =>
          q.eq("targetOrgId", fixture.clientOrgId),
        )
        .collect(),
    );

    expect(details).toMatchObject({
      name: "Supported Client",
      website: "https://supported.example.com",
      industry: "professional_services",
      industryVertical: "consulting",
      primaryInsuranceContactId: fixture.memberUserId,
      profileOverrides: {
        entityType: "limited_liability_company",
        fein: "12-3456789",
        operationsDescription: "Technology consulting services",
      },
    });
    expect(members).toEqual([
      expect.objectContaining({
        userId: fixture.memberUserId,
        name: "Support Updated",
        title: "Risk Manager",
        role: "admin",
      }),
    ]);
    expect(invitations).toEqual([
      expect.objectContaining({ _id: fixture.invitationId }),
    ]);
    expect(audits.length).toBeGreaterThanOrEqual(6);
  });

  test("does not let a customer opt into the operator target scope", async () => {
    const fixture = await seedSupportFixture();
    const clientAdmin = fixture.t.withIdentity({
      subject: `${fixture.adminUserId}|session`,
    });

    await expect(
      clientAdmin.query(listMembersFn, {
        operatorClientOrgId: fixture.clientOrgId,
      }),
    ).rejects.toThrow();

    await expect(clientAdmin.query(listMembersFn, {})).resolves.toHaveLength(2);
  });

  test("sends operator-scoped invitations and verified email changes", async () => {
    const fixture = await seedSupportFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    vi.stubEnv("GLASS_ENV", "local");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await operator.action(sendMemberInvitationFn, {
        operatorClientOrgId: fixture.clientOrgId,
        email: "new-member@example.com",
        role: "member",
      });
      await operator.action(requestMemberEmailChangeFn, {
        operatorClientOrgId: fixture.clientOrgId,
        membershipId: fixture.memberMembershipId,
        email: "member-updated@example.com",
      });
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }

    const invitations = await operator.query(listInvitationsFn, {
      operatorClientOrgId: fixture.clientOrgId,
    });
    const members = await operator.query(listMembersFn, {
      operatorClientOrgId: fixture.clientOrgId,
    });

    expect(invitations).toContainEqual(
      expect.objectContaining({
        email: "new-member@example.com",
        role: "member",
        status: "pending",
      }),
    );
    expect(members).toContainEqual(
      expect.objectContaining({
        userId: fixture.memberUserId,
        pendingEmailChange: expect.objectContaining({
          newEmail: "member-updated@example.com",
          requestedByUserId: fixture.operatorUserId,
        }),
      }),
    );
  });
});
