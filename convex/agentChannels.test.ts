/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  cancelSlackSetup,
  finishSlackSetup,
  get,
  getForOperator,
  getSlackHostStatus,
  listOperatorSlackIdentities,
  setOperatorSlackIdentity,
  setSlackSetupStep,
  startSlackSetup,
  update,
  updateForOperator,
  updateStandaloneAgentEmailHandleForOperator,
} from "./agentChannels";
import { resolveForAction } from "./lib/agentScope";
import { SLACK_CUSTOMER_SCOPES } from "./lib/slackOAuthPolicy";

const modules = import.meta.glob("./**/*.ts");
const cancelSlackSetupFn = cancelSlackSetup as any;
const finishSlackSetupFn = finishSlackSetup as any;
const getFn = get as any;
const getForOperatorFn = getForOperator as any;
const getSlackHostStatusFn = getSlackHostStatus as any;
const listOperatorSlackIdentitiesFn = listOperatorSlackIdentities as any;
const setOperatorSlackIdentityFn = setOperatorSlackIdentity as any;
const setSlackSetupStepFn = setSlackSetupStep as any;
const startSlackSetupFn = startSlackSetup as any;
const updateFn = update as any;
const updateForOperatorFn = updateForOperator as any;
const updateStandaloneAgentEmailHandleForOperatorFn =
  updateStandaloneAgentEmailHandleForOperator as any;
const resolveForActionFn = resolveForAction as any;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agent channel settings", () => {
  test("reports mock Slack as configured without requiring live OAuth", async () => {
    vi.stubEnv("SLACK_MODE", "mock");
    vi.stubEnv("SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-FIXTURE");
    const t = convexTest(schema, modules);
    const operatorUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "operator@claritylabs.test",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "operator@claritylabs.test",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return userId;
    });

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .query(getSlackHostStatusFn, {}),
    ).resolves.toEqual({
      mode: "mock",
      enabled: true,
      configured: true,
      hostTeamId: "T-FIXTURE",
      installation: null,
    });
  });

  test("reports global Slack enablement separately from live setup", async () => {
    vi.stubEnv("SLACK_MODE", "slack");
    vi.stubEnv("SLACK_ENABLED", "false");
    vi.stubEnv("SLACK_CLIENT_ID", "client-id");
    vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "encryption-key");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-CLARITY");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
    const t = convexTest(schema, modules);
    const operatorUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "operator@claritylabs.test",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "operator@claritylabs.test",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return userId;
    });

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .query(getSlackHostStatusFn, {}),
    ).resolves.toEqual({
      mode: "slack",
      enabled: false,
      configured: true,
      hostTeamId: "T-CLARITY",
      installation: null,
    });
  });

  test("lists the signed-in operator first alongside every other Spot operator", async () => {
    const t = convexTest(schema, modules);
    const { currentUserId, activeUserId, disabledUserId } = await t.run(
      async (ctx) => {
        const currentUserId = await ctx.db.insert("users", {
          name: "Current Operator",
          email: "current@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: currentUserId,
          email: "current@spot.insure",
          role: "owner",
          status: "active",
          slackTeamId: "T-SPOT",
          slackUserId: "U-CURRENT",
          createdAt: 1,
          updatedAt: 1,
        });

        const activeUserId = await ctx.db.insert("users", {
          name: "Active Operator",
          email: "active@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: activeUserId,
          email: "active@spot.insure",
          role: "operator",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });

        const disabledUserId = await ctx.db.insert("users", {
          email: "disabled@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: disabledUserId,
          email: "disabled@spot.insure",
          role: "operator",
          status: "disabled",
          slackTeamId: "T-OLD",
          slackUserId: "U-DISABLED",
          createdAt: 1,
          updatedAt: 1,
        });

        return { currentUserId, activeUserId, disabledUserId };
      },
    );

    await expect(
      t
        .withIdentity({ subject: `${currentUserId}|session` })
        .query(listOperatorSlackIdentitiesFn, {}),
    ).resolves.toEqual([
      {
        userId: currentUserId,
        name: "Current Operator",
        email: "current@spot.insure",
        role: "owner",
        status: "active",
        slackTeamId: "T-SPOT",
        slackUserId: "U-CURRENT",
        isCurrent: true,
      },
      {
        userId: activeUserId,
        name: "Active Operator",
        email: "active@spot.insure",
        role: "operator",
        status: "active",
        slackTeamId: null,
        slackUserId: null,
        isCurrent: false,
      },
      {
        userId: disabledUserId,
        name: null,
        email: "disabled@spot.insure",
        role: "operator",
        status: "disabled",
        slackTeamId: "T-OLD",
        slackUserId: "U-DISABLED",
        isCurrent: false,
      },
    ]);
  });

  test("defaults legacy clients to email/iMessage on and Slack off", async () => {
    const t = convexTest(schema, modules);
    const { memberUserId, orgId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Legacy Client",
        type: "client",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
      return { memberUserId, orgId };
    });
    await expect(
      t
        .withIdentity({ subject: `${memberUserId}|session` })
        .query(getFn, { clientOrgId: orgId }),
    ).resolves.toMatchObject({
      agentEmailAddress: {
        handle: "agent",
        configuredHandle: null,
        source: "shared",
        ownerOrgId: orgId,
        ownerName: "Legacy Client",
      },
      settings: {
        emailEnabled: true,
        imessageEnabled: true,
        slackEnabled: false,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
      },
    });
  });

  test("resolves broker-owned email addresses for managed clients", async () => {
    const t = convexTest(schema, modules);
    const { brokerAdminUserId, clientOrgId, brokerOrgId } = await t.run(
      async (ctx) => {
        const brokerOrgId = await ctx.db.insert("organizations", {
          name: "Managing Broker",
          type: "broker",
          agentHandle: "managing-broker",
        });
        const clientOrgId = await ctx.db.insert("organizations", {
          name: "Managed Client",
          type: "client",
          brokerOrgId,
          agentHandle: "unused-client-handle",
        });
        const brokerAdminUserId = await ctx.db.insert("users", {
          email: "admin@broker.test",
        });
        await ctx.db.insert("orgMemberships", {
          orgId: brokerOrgId,
          userId: brokerAdminUserId,
          role: "admin",
        });
        return { brokerAdminUserId, clientOrgId, brokerOrgId };
      },
    );

    await expect(
      t
        .withIdentity({ subject: `${brokerAdminUserId}|session` })
        .query(getFn, { clientOrgId }),
    ).resolves.toMatchObject({
      agentEmailAddress: {
        handle: "managing-broker",
        configuredHandle: "managing-broker",
        source: "broker",
        ownerOrgId: brokerOrgId,
        ownerName: "Managing Broker",
      },
    });
  });

  test("lets operators manage only standalone client email addresses", async () => {
    const t = convexTest(schema, modules);
    const { operatorUserId, standaloneOrgId, managedOrgId } = await t.run(
      async (ctx) => {
        const operatorUserId = await ctx.db.insert("users", {
          email: "operator@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: operatorUserId,
          email: "operator@spot.insure",
          role: "operator",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
        const brokerOrgId = await ctx.db.insert("organizations", {
          name: "Broker",
          type: "broker",
          agentHandle: "broker",
        });
        const standaloneOrgId = await ctx.db.insert("organizations", {
          name: "Standalone Client",
          type: "client",
        });
        const managedOrgId = await ctx.db.insert("organizations", {
          name: "Managed Client",
          type: "client",
          brokerOrgId,
        });
        return { operatorUserId, standaloneOrgId, managedOrgId };
      },
    );
    const operator = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    await expect(
      operator.mutation(updateStandaloneAgentEmailHandleForOperatorFn, {
        clientOrgId: standaloneOrgId,
        handle: "standalone-client",
      }),
    ).resolves.toBe("standalone-client");
    await expect(
      operator.query(getForOperatorFn, { clientOrgId: standaloneOrgId }),
    ).resolves.toMatchObject({
      agentEmailAddress: {
        handle: "standalone-client",
        configuredHandle: "standalone-client",
        source: "client",
      },
    });

    await expect(
      operator.mutation(updateStandaloneAgentEmailHandleForOperatorFn, {
        clientOrgId: standaloneOrgId,
      }),
    ).resolves.toBeNull();
    await expect(
      operator.query(getForOperatorFn, { clientOrgId: standaloneOrgId }),
    ).resolves.toMatchObject({
      agentEmailAddress: {
        handle: "agent",
        configuredHandle: null,
        source: "shared",
      },
    });
    await expect(
      operator.mutation(updateStandaloneAgentEmailHandleForOperatorFn, {
        clientOrgId: managedOrgId,
        handle: "managed-client",
      }),
    ).rejects.toThrow(
      "This client inherits its agent email address from its broker",
    );

    const records = await t.run(async (ctx) => ({
      standalone: await ctx.db.get(standaloneOrgId),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.standalone?.agentHandle).toBeUndefined();
    expect(records.audits.map((audit) => audit.summary)).toEqual([
      "Updated agent email address for Standalone Client",
      "Updated agent email address for Standalone Client",
    ]);
  });

  test("persists operator-led setup steps and sanitizes unfinished setup for clients", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId, adminUserId } = await t.run(
      async (ctx) => {
        const clientOrgId = await ctx.db.insert("organizations", {
          name: "Setup Client",
          type: "client",
        });
        const operatorUserId = await ctx.db.insert("users", {
          name: "Spot Operator",
          email: "operator@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: operatorUserId,
          email: "operator@spot.insure",
          role: "operator",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
        const adminUserId = await ctx.db.insert("users", {
          email: "admin@setup-client.test",
        });
        await ctx.db.insert("orgMemberships", {
          orgId: clientOrgId,
          userId: adminUserId,
          role: "admin",
        });
        return { clientOrgId, operatorUserId, adminUserId };
      },
    );
    const operator = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });
    const admin = t.withIdentity({ subject: `${adminUserId}|session` });

    await operator.mutation(startSlackSetupFn, {
      clientOrgId,
      mode: "initial",
    });
    await operator.mutation(setSlackSetupStepFn, {
      clientOrgId,
      step: "support",
      deferredStep: "install",
    });
    await operator.mutation(setSlackSetupStepFn, {
      clientOrgId,
      step: "channels",
      deferredStep: "support",
    });

    const operatorOverview = await operator.query(getForOperatorFn, {
      clientOrgId,
    });
    expect(operatorOverview.setup).toMatchObject({
      mode: "initial",
      status: "in_progress",
      currentStep: "channels",
      deferredSteps: ["install", "support"],
      startedByOperatorUserId: operatorUserId,
    });
    const clientOverview = await admin.query(getFn, { clientOrgId });
    expect(clientOverview.setup).toEqual({ status: "in_progress" });
    expect(clientOverview.setup).not.toHaveProperty("currentStep");

    await expect(
      admin.mutation(startSlackSetupFn, {
        clientOrgId,
        mode: "initial",
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(setSlackSetupStepFn, {
        clientOrgId,
        step: "automations",
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(finishSlackSetupFn, { clientOrgId }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(cancelSlackSetupFn, { clientOrgId }),
    ).rejects.toThrow();
    await expect(
      operator.mutation(finishSlackSetupFn, { clientOrgId }),
    ).rejects.toThrow("Install or update Spot in Slack");

    await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-SETUP",
        teamName: "Setup workspace",
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 2,
        updatedAt: 2,
      });
    });
    await operator.mutation(finishSlackSetupFn, { clientOrgId });
    await expect(
      operator.query(getForOperatorFn, { clientOrgId }),
    ).resolves.toMatchObject({
      setup: {
        status: "completed",
        currentStep: "automations",
        deferredSteps: ["support"],
        completedByOperatorUserId: operatorUserId,
      },
    });
  });

  test("treats a valid legacy Slack connection as complete without setup state", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Slack Client",
        type: "client",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@spot.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@spot.insure",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const serviceUserId = await ctx.db.insert("users", {
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-LEGACY",
        teamName: "Legacy workspace",
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return { clientOrgId, operatorUserId };
    });

    const overview = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .query(getForOperatorFn, { clientOrgId });
    expect(overview.connection).toMatchObject({ teamId: "T-LEGACY" });
    expect(overview.setup).toBeNull();
  });

  test("requires reinstall when an active Slack connection lacks reaction scope", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Slack Client",
        type: "client",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@spot.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@spot.insure",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const serviceUserId = await ctx.db.insert("users", {
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-LEGACY",
        teamName: "Legacy workspace",
        grantedScopes: SLACK_CUSTOMER_SCOPES.filter(
          (scope) => scope !== "reactions:write",
        ),
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return { clientOrgId, operatorUserId };
    });

    const overview = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .query(getForOperatorFn, { clientOrgId });
    expect(overview.slackHealth).toMatchObject({
      status: "degraded",
      reasonCode: "missing_required_scopes",
      recoveryAction: "reinstall",
    });
    expect(overview.slackHealth.reasonSummary).toContain("reactions:write");
  });

  test("cancels a reinstall without changing the working Slack configuration", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId, connectionId, bindingId } =
      await t.run(async (ctx) => {
        const clientOrgId = await ctx.db.insert("organizations", {
          name: "Repair Client",
          type: "client",
        });
        const operatorUserId = await ctx.db.insert("users", {
          email: "operator@spot.insure",
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId: operatorUserId,
          email: "operator@spot.insure",
          role: "operator",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
        const serviceUserId = await ctx.db.insert("users", {
          accountKind: "customer",
          serviceAccountKind: "slack",
        });
        const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
          clientOrgId,
          teamId: "T-REPAIR",
          teamName: "Repair workspace",
          grantedScopes: [...SLACK_CUSTOMER_SCOPES],
          status: "active",
          serviceUserId,
          thirdPartyVisibilityAcknowledged: true,
          automaticChannelId: "C-DEFAULT",
          automaticChannelName: "policy-updates",
          automaticChannelRoutingConfiguredAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        const bindingId = await ctx.db.insert("slackChannelBindings", {
          clientOrgId,
          connectionId,
          kind: "primary",
          hostTeamId: "T-CLARITY",
          hostChannelId: "C-HOST",
          customerChannelId: "C-SUPPORT",
          channelName: "spot-repair-client",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("agentChannelSettings", {
          clientOrgId,
          emailEnabled: true,
          imessageEnabled: true,
          slackEnabled: true,
          slackSafeAlertsEnabled: true,
          slackVendorAlertsEnabled: true,
          slackPolicyDeliveryEnabled: true,
          createdAt: 1,
          updatedAt: 1,
        });
        return { clientOrgId, operatorUserId, connectionId, bindingId };
      });
    const operator = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    await operator.mutation(startSlackSetupFn, {
      clientOrgId,
      mode: "reinstall",
    });
    await expect(
      operator.mutation(finishSlackSetupFn, { clientOrgId }),
    ).rejects.toThrow("Finish the Slack reinstall");
    await operator.mutation(cancelSlackSetupFn, { clientOrgId });

    const records = await t.run(async (ctx) => ({
      setup: await ctx.db.query("slackSetupStates").first(),
      connection: await ctx.db.get(connectionId),
      binding: await ctx.db.get(bindingId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(records.setup?.status).toBe("cancelled");
    expect(records.connection).toMatchObject({
      status: "active",
      automaticChannelId: "C-DEFAULT",
    });
    expect(records.binding?.status).toBe("active");
    expect(records.settings).toMatchObject({
      slackEnabled: true,
      slackVendorAlertsEnabled: true,
    });
  });

  test("returns persisted settings as mutation-safe input", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, orgId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Configured Client",
        type: "client",
      });
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@configured-client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: adminUserId,
        role: "admin",
      });
      await ctx.db.insert("agentChannelSettings", {
        clientOrgId: orgId,
        emailEnabled: true,
        imessageEnabled: true,
        slackEnabled: true,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
        updatedByUserId: adminUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminUserId, orgId };
    });
    const admin = t.withIdentity({ subject: `${adminUserId}|session` });

    const overview = await admin.query(getFn, { clientOrgId: orgId });
    expect(overview.settings).toEqual({
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: true,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
    });
    await expect(
      admin.mutation(updateFn, {
        ...overview.settings,
        slackEnabled: false,
      }),
    ).resolves.toBeTruthy();
  });

  test("allows client admins and rejects ordinary members", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@client.com",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: adminUserId,
        role: "admin",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
      return { adminUserId, memberUserId };
    });
    const settings = {
      emailEnabled: true,
      imessageEnabled: false,
      slackEnabled: false,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
    };
    await expect(
      t
        .withIdentity({ subject: `${memberUserId}|session` })
        .mutation(updateFn, settings),
    ).rejects.toThrow("Only an organization admin can perform this action");
    await expect(
      t
        .withIdentity({ subject: `${adminUserId}|session` })
        .mutation(updateFn, settings),
    ).resolves.toBeTruthy();
  });

  test("audits operator-managed channel settings and Slack identity", async () => {
    vi.stubEnv("SLACK_MODE", "mock");
    vi.stubEnv("SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-SPOT");
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@spot.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@spot.insure",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return { clientOrgId, operatorUserId };
    });
    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await operator.mutation(updateForOperatorFn, {
      clientOrgId,
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: false,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
    });
    await operator.mutation(setOperatorSlackIdentityFn, {
      teamId: "T-SPOT",
      userId: "U-OPERATOR",
    });

    const records = await t.run(async (ctx) => ({
      profile: await ctx.db.query("operatorProfiles").first(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.profile).toMatchObject({
      slackTeamId: "T-SPOT",
      slackUserId: "U-OPERATOR",
    });
    expect(records.audits.map((audit) => audit.summary)).toEqual([
      "Updated client agent channel settings",
      "Connected operator Slack identity",
    ]);
  });

  test("rejects an operator identity from a different Slack workspace", async () => {
    vi.stubEnv("SLACK_MODE", "mock");
    vi.stubEnv("SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-SPOT");
    const t = convexTest(schema, modules);
    const operatorUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "operator@spot.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "operator@spot.insure",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return userId;
    });

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .mutation(setOperatorSlackIdentityFn, {
          teamId: "T-OTHER",
          userId: "U-OPERATOR",
        }),
    ).rejects.toThrow(
      "The operator identity must belong to the configured Clarity Slack workspace",
    );
  });

  test("enforces explicit email and iMessage availability without changing legacy defaults", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", { email: "user@client.com" });
      await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
      return { orgId, userId };
    });
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "email" }),
    ).resolves.toMatchObject({ surface: "email" });

    await t.run(async (ctx) => {
      await ctx.db.insert("agentChannelSettings", {
        clientOrgId: orgId,
        emailEnabled: false,
        imessageEnabled: false,
        slackEnabled: false,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "email" }),
    ).rejects.toThrow("Email agent access is disabled");
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "imessage" }),
    ).rejects.toThrow("iMessage agent access is disabled");
  });

  test("grants customer members and recognized operators client-admin-equivalent Slack scope", async () => {
    const t = convexTest(schema, modules);
    const {
      orgId,
      serviceUserId,
      customerActorId,
      operatorActorId,
      externalActorId,
    } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const serviceUserId = await ctx.db.insert("users", {
        name: "Spot Slack",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId: orgId,
        teamId: "T-CUSTOMER",
        teamName: "Client",
        grantedScopes: [],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("agentChannelSettings", {
        clientOrgId: orgId,
        emailEnabled: true,
        imessageEnabled: true,
        slackEnabled: true,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const actor = async (
        teamId: string,
        slackUserId: string,
        classification: "customer_member" | "spot_operator" | "external",
      ) =>
        await ctx.db.insert("slackActors", {
          connectionId,
          clientOrgId: orgId,
          teamId,
          slackUserId,
          classification,
          createdAt: 1,
          updatedAt: 1,
        });
      return {
        orgId,
        serviceUserId,
        customerActorId: await actor(
          "T-CUSTOMER",
          "U-CUSTOMER",
          "customer_member",
        ),
        operatorActorId: await actor(
          "T-CLARITY",
          "U-OPERATOR",
          "spot_operator",
        ),
        externalActorId: await actor("T-VENDOR", "U-VENDOR", "external"),
      };
    });

    for (const slackActorId of [customerActorId, operatorActorId]) {
      await expect(
        t.query(resolveForActionFn, {
          orgId,
          userId: serviceUserId,
          surface: "slack",
          slackActorId,
        }),
      ).resolves.toMatchObject({
        mode: "client",
        writableOrgIds: [orgId],
        actorRef: { kind: "slack", actorId: slackActorId },
      });
    }
    await expect(
      t.query(resolveForActionFn, {
        orgId,
        userId: serviceUserId,
        surface: "slack",
        slackActorId: externalActorId,
      }),
    ).rejects.toThrow("access");
  });
});
