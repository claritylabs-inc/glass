/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const internalApi = internal as any;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Lifecycle Client",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Spot Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId,
      teamId: "T-CUSTOMER",
      teamName: "Customer",
      appId: "A-SPOT",
      botUserId: "U-SPOT",
      grantedScopes: ["chat:write"],
      status: "active",
      healthStatus: "healthy",
      authorizationUpdatedAt: 100,
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      createdAt: 100,
      updatedAt: 100,
    });
    const bindingId = await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId,
      kind: "primary",
      hostTeamId: "T-HOST",
      hostChannelId: "C-HOST",
      customerChannelId: "C-CUSTOMER",
      channelName: "spot-lifecycle",
      status: "active",
      healthStatus: "healthy",
      boundAt: 100,
      createdAt: 100,
      updatedAt: 100,
    });
    return { clientOrgId, connectionId, bindingId };
  });
}

async function processEvent(
  t: ReturnType<typeof convexTest>,
  fields: Record<string, unknown>,
) {
  const eventId = await t.run(
    async (ctx) =>
      await ctx.db.insert("slackLifecycleEvents", {
        source: "slack",
        eventKey: String(fields.eventKey),
        eventType: String(fields.eventType),
        status: "claimed",
        attempts: 0,
        eventAt: 200,
        receivedAt: 200,
        ...fields,
      } as any),
  );
  await t.mutation(internalApi.slackLifecycle.process, { eventId });
  return eventId;
}

describe("Slack lifecycle state machine", () => {
  test("ignores unrelated bot-token revocations", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seed(t);
    const eventId = await processEvent(t, {
      eventKey: "slack:unrelated-token",
      eventType: "tokens_revoked",
      teamId: "T-CUSTOMER",
      apiAppId: "A-SPOT",
      botUserIds: ["U-OTHER"],
    });
    const state = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      event: await ctx.db.get(eventId),
    }));
    expect(state.connection?.status).toBe("active");
    expect(state.event?.status).toBe("ignored");
  });

  test("revokes matching bot authorization without deleting preferences", async () => {
    const t = convexTest(schema, modules);
    const { connectionId, clientOrgId } = await seed(t);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("agentChannelSettings", {
          clientOrgId,
          emailEnabled: true,
          imessageEnabled: true,
          slackEnabled: true,
          slackSafeAlertsEnabled: true,
          slackVendorAlertsEnabled: false,
          slackPolicyDeliveryEnabled: true,
          createdAt: 100,
          updatedAt: 100,
        }),
    );
    await processEvent(t, {
      eventKey: "slack:matching-token",
      eventType: "tokens_revoked",
      teamId: "T-CUSTOMER",
      apiAppId: "A-SPOT",
      botUserIds: ["U-SPOT"],
    });
    const state = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(state.connection).toMatchObject({
      status: "revoked",
      healthStatus: "degraded",
      healthReason: "bot_token_revoked",
    });
    expect(state.settings?.slackEnabled).toBe(true);
  });

  test("updates only the customer-side identity on channel ID change", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    await processEvent(t, {
      eventKey: "slack:channel-id-change",
      eventType: "channel_id_changed",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      oldChannelId: "C-CUSTOMER",
      newChannelId: "C-CUSTOMER-NEW",
    });
    const binding = await t.run((ctx) => ctx.db.get(bindingId));
    expect(binding).toMatchObject({
      hostChannelId: "C-HOST",
      customerChannelId: "C-CUSTOMER-NEW",
      previousCustomerChannelId: "C-CUSTOMER",
    });
  });

  test("updates only the host-side identity on a host channel ID change", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    await processEvent(t, {
      eventKey: "slack:host-channel-id-change",
      eventType: "channel_id_changed",
      teamId: "T-HOST",
      authorizationTeamId: "T-HOST",
      oldChannelId: "C-HOST",
      newChannelId: "C-HOST-NEW",
    });
    const binding = await t.run((ctx) => ctx.db.get(bindingId));
    expect(binding).toMatchObject({
      hostChannelId: "C-HOST-NEW",
      previousHostChannelId: "C-HOST",
      customerChannelId: "C-CUSTOMER",
    });
  });

  test("renames, archives, and safely unarchives the selected channel", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    await processEvent(t, {
      eventKey: "slack:channel-rename",
      eventType: "channel_rename",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      channelName: "spot-renamed",
    });
    await processEvent(t, {
      eventKey: "slack:channel-archive",
      eventType: "channel_archive",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      eventAt: 300,
    });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      channelName: "spot-renamed",
      status: "unavailable",
      unavailableReason: "channel_archived",
    });

    await processEvent(t, {
      eventKey: "slack:channel-unarchive",
      eventType: "channel_unarchive",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      eventAt: 400,
    });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      status: "active",
      healthStatus: "healthy",
    });
  });

  test("tracks host-side unshare and restores only from the matching re-share", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    await processEvent(t, {
      eventKey: "slack:host-unshared",
      eventType: "channel_unshared",
      teamId: "T-HOST",
      authorizationTeamId: "T-HOST",
      channelId: "C-HOST",
      previouslyConnectedTeamId: "T-CUSTOMER",
    });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      status: "unavailable",
      unavailableReason: "host_channel_unshared",
    });

    await processEvent(t, {
      eventKey: "slack:wrong-host-share",
      eventType: "channel_shared",
      teamId: "T-HOST",
      authorizationTeamId: "T-HOST",
      channelId: "C-HOST",
      connectedTeamId: "T-OTHER",
      eventAt: 300,
    });
    expect((await t.run((ctx) => ctx.db.get(bindingId)))?.status).toBe(
      "unavailable",
    );

    await processEvent(t, {
      eventKey: "slack:host-reshared",
      eventType: "channel_shared",
      teamId: "T-HOST",
      authorizationTeamId: "T-HOST",
      channelId: "C-HOST",
      connectedTeamId: "T-CUSTOMER",
      eventAt: 400,
    });
    expect((await t.run((ctx) => ctx.db.get(bindingId)))?.status).toBe(
      "active",
    );
  });

  test("keeps deleted channels unavailable until an audited rebind", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    await processEvent(t, {
      eventKey: "slack:channel-deleted",
      eventType: "channel_deleted",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
    });
    await processEvent(t, {
      eventKey: "slack:share-after-delete",
      eventType: "channel_shared",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      connectedTeamId: "T-HOST",
      eventAt: 300,
    });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      status: "unavailable",
      unavailableReason: "channel_deleted",
    });
  });

  test("ignores events older than the current binding", async () => {
    const t = convexTest(schema, modules);
    const { bindingId } = await seed(t);
    const eventId = await processEvent(t, {
      eventKey: "slack:stale-archive",
      eventType: "channel_archive",
      teamId: "T-HOST",
      authorizationTeamId: "T-HOST",
      channelId: "C-HOST",
      eventAt: 99,
    });
    const state = await t.run(async (ctx) => ({
      binding: await ctx.db.get(bindingId),
      event: await ctx.db.get(eventId),
    }));
    expect(state.binding?.status).toBe("active");
    expect(state.event?.status).toBe("ignored");
  });

  test("degrades on transient reconciliation failure and restores after verification", async () => {
    const t = convexTest(schema, modules);
    const { connectionId, bindingId } = await seed(t);
    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 100,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 300,
      ok: false,
      errorCode: "ratelimited",
      errorSummary: "Slack asked Spot to retry later",
      retryable: true,
      channels: [],
    });
    await expect(
      t.run((ctx) => ctx.db.get(connectionId)),
    ).resolves.toMatchObject({
      status: "active",
      healthStatus: "degraded",
      reconciliationFailureCount: 1,
    });

    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 100,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 400,
      ok: true,
      botUserId: "U-SPOT",
      channels: [
        {
          id: "C-CUSTOMER",
          ok: true,
          name: "spot-lifecycle",
          isArchived: false,
          isMember: true,
          isPrivate: true,
          isShared: true,
          isExtShared: true,
          isOrgShared: false,
        },
      ],
    });
    const restored = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      binding: await ctx.db.get(bindingId),
    }));
    expect(restored.connection).toMatchObject({
      status: "active",
      healthStatus: "healthy",
      reconciliationFailureCount: 0,
      lastVerifiedAt: 400,
    });
    expect(restored.binding).toMatchObject({
      status: "active",
      healthStatus: "healthy",
      lastVerifiedAt: 400,
    });
  });

  test("revokes definitive invalid auth and makes stale reconciliation harmless", async () => {
    const t = convexTest(schema, modules);
    const { connectionId, bindingId } = await seed(t);
    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 99,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 250,
      ok: false,
      errorCode: "invalid_auth",
      errorSummary: "invalid_auth",
      retryable: false,
      channels: [],
    });
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.status).toBe(
      "active",
    );

    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 100,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 300,
      ok: false,
      errorCode: "invalid_auth",
      errorSummary: "invalid_auth",
      retryable: false,
      channels: [],
    });
    await expect(
      t.run((ctx) => ctx.db.get(connectionId)),
    ).resolves.toMatchObject({
      status: "revoked",
      healthReason: "authorization_invalid",
      providerErrorCode: "invalid_auth",
    });
  });

  test("marks a missing primary channel unavailable and restores the same ID", async () => {
    const t = convexTest(schema, modules);
    const { connectionId, bindingId } = await seed(t);
    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 100,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 300,
      ok: true,
      botUserId: "U-SPOT",
      channels: [
        {
          id: "C-CUSTOMER",
          ok: false,
          errorCode: "channel_not_found",
          retryable: false,
        },
      ],
    });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      status: "unavailable",
      unavailableReason: "channel_not_found",
    });

    await t.mutation(internalApi.slackLifecycle.applyReconciliationResult, {
      connectionId,
      expectedAuthorizationUpdatedAt: 100,
      expectedBindingId: bindingId,
      expectedBindingBoundAt: 100,
      side: "customer",
      teamId: "T-CUSTOMER",
      checkedAt: 400,
      ok: true,
      botUserId: "U-SPOT",
      channels: [
        {
          id: "C-CUSTOMER",
          ok: true,
          name: "spot-lifecycle",
          isArchived: false,
          isMember: true,
          isPrivate: true,
          isShared: true,
          isExtShared: true,
          isOrgShared: false,
        },
      ],
    });
    expect((await t.run((ctx) => ctx.db.get(bindingId)))?.status).toBe(
      "active",
    );
  });
});
