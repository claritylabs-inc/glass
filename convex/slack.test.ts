/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  claimBatch,
  claimInbound,
  createDeliveryRecord,
  enrichInboundActor,
  failEvents,
  prepareBatch,
} from "./slack";
import { processDebounced } from "./actions/handleInboundSlack";
import {
  claimOAuthState,
  createOAuthState,
  disconnectInternal,
  revokeByTeamId,
  upsertSlackConnection,
} from "./agentChannels";
import {
  claim as claimOutbound,
  getSendTarget,
  markFailed,
  markSent,
} from "./slackOutbound";
import { notifyInternal } from "./lib/notify";

const modules = import.meta.glob("./**/*.ts");
const claimInboundFn = claimInbound as any;
const claimBatchFn = claimBatch as any;
const createDeliveryRecordFn = createDeliveryRecord as any;
const enrichInboundActorFn = enrichInboundActor as any;
const failEventsFn = failEvents as any;
const prepareBatchFn = prepareBatch as any;
const claimOAuthStateFn = claimOAuthState as any;
const createOAuthStateFn = createOAuthState as any;
const disconnectInternalFn = disconnectInternal as any;
const revokeByTeamIdFn = revokeByTeamId as any;
const upsertSlackConnectionFn = upsertSlackConnection as any;
const claimOutboundFn = claimOutbound as any;
const getSendTargetFn = getSendTarget as any;
const markFailedFn = markFailed as any;
const markSentFn = markSent as any;
const notifyInternalFn = notifyInternal as any;
const processDebouncedFn = processDebounced as any;
const BASE_TIME = dayjs().add(1, "minute").valueOf();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedSlack(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Glass Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: serviceUserId,
      role: "admin",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId,
      teamId: "T-CUSTOMER",
      teamName: "Cove",
      botUserId: "U-GLASS",
      grantedScopes: ["app_mentions:read", "chat:write"],
      status: "active",
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("agentChannelSettings", {
      clientOrgId,
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: true,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId,
      kind: "primary",
      hostTeamId: "T-GLASS",
      hostChannelId: "C-HOST",
      customerChannelId: "C-PRIMARY",
      channelName: "glass-cove",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("slackChannelMemberships", {
      connectionId,
      clientOrgId,
      channelId: "C-PRIMARY",
      channelName: "insurance-support",
      isPrivate: false,
      isShared: true,
      status: "active",
      lastSyncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const operatorUserId = await ctx.db.insert("users", {
      name: "Glass Operator",
      email: "operator@glass.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@glass.insure",
      role: "operator",
      status: "active",
      slackTeamId: "T-GLASS",
      slackUserId: "U-OPERATOR",
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientOrgId, connectionId, serviceUserId, operatorUserId };
  });
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  args: {
    eventKey: string;
    content: string;
    threadTs?: string;
    messageTs?: string;
    channelId?: string;
    senderTeamId?: string;
    senderUserId?: string;
    senderDisplayName?: string;
    senderEmail?: string;
    eventType?: "message" | "edit" | "delete";
    isDirectMessage?: boolean;
    isPrivateChannel?: boolean;
    receivedAt?: number;
  },
) {
  const result = (await t.mutation(claimInboundFn, {
    eventKey: args.eventKey,
    spectrumMessageId: args.eventKey,
    teamId: "T-CUSTOMER",
    channelId: args.channelId ?? "C-PRIMARY",
    threadTs: args.threadTs ?? "1800000000.000",
    messageTs: args.messageTs ?? args.eventKey,
    senderTeamId: args.senderTeamId ?? "T-CUSTOMER",
    senderUserId: args.senderUserId ?? "U-CUSTOMER",
    senderDisplayName: args.senderDisplayName,
    senderEmail: args.senderEmail,
    content: args.content,
    eventType: args.eventType ?? "message",
    isDirectMessage: args.isDirectMessage,
    isPrivateChannel: args.isPrivateChannel,
    receivedAt: args.receivedAt ?? BASE_TIME,
  })) as {
    eventId?: Id<"slackInboundEvents">;
    duplicate: boolean;
    status: string;
  };
  if (!result.eventId) return { claim: result, prepared: null };
  const prepared = await t.mutation(prepareBatchFn, {
    eventIds: [result.eventId],
  });
  return { claim: result, prepared };
}

describe("Slack channel state and authorization", () => {
  test("fails closed until Slack resolves a sender's native workspace", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedSlack(t);
    const claim = (await t.mutation(claimInboundFn, {
      eventKey: "event-native-team",
      spectrumMessageId: "event-native-team",
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.050",
      messageTs: "1800000000.050",
      senderUserId: "U-OPERATOR",
      content: "I can take this one.",
      eventType: "message",
      receivedAt: BASE_TIME,
    })) as { eventId: Id<"slackInboundEvents"> };

    await expect(
      t.mutation(prepareBatchFn, { eventIds: [claim.eventId] }),
    ).rejects.toThrow("Slack actor workspace has not been resolved");
    await t.run(async (ctx) => {
      await ctx.db.patch(claim.eventId, { status: "processing" });
    });
    await t.mutation(enrichInboundActorFn, {
      eventId: claim.eventId,
      senderTeamId: "T-GLASS",
      senderDisplayName: "Glass Operator",
      senderIsBot: false,
    });
    await expect(
      t.mutation(prepareBatchFn, { eventIds: [claim.eventId] }),
    ).resolves.toBeNull();

    const state = await t.run(async (ctx) => ({
      actor: await ctx.db
        .query("slackActors")
        .withIndex("by_connectionId_and_teamId_and_slackUserId", (q) =>
          q
            .eq("connectionId", connectionId)
            .eq("teamId", "T-GLASS")
            .eq("slackUserId", "U-OPERATOR"),
        )
        .unique(),
      thread: await ctx.db
        .query("threads")
        .withIndex(
          "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
          (q) =>
            q
              .eq("slackConnectionId", connectionId)
              .eq("slackChannelId", "C-PRIMARY")
              .eq("slackThreadTs", "1800000000.050"),
        )
        .unique(),
    }));
    expect(state.actor?.classification).toBe("glass_operator");
    expect(state.thread?.slackState).toBe("human_paused");
  });

  test("routes Clarity-side Connect events through the host binding", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    const claim = (await t.mutation(claimInboundFn, {
      eventKey: "event-host-side",
      spectrumMessageId: "event-host-side",
      teamId: "T-GLASS",
      channelId: "C-HOST",
      threadTs: "1800000000.075",
      messageTs: "1800000000.075",
      senderUserId: "U-CUSTOMER",
      content: "<@U-GLASS-HOST> show my policy",
      eventType: "message",
      receivedAt: BASE_TIME,
    })) as {
      eventId: Id<"slackInboundEvents">;
      status: string;
    };
    expect(claim.status).toBe("queued");
    await t.run(async (ctx) => {
      await ctx.db.patch(claim.eventId, { status: "processing" });
    });
    await t.mutation(enrichInboundActorFn, {
      eventId: claim.eventId,
      senderTeamId: "T-CUSTOMER",
      senderDisplayName: "Customer Admin",
      senderIsBot: false,
      installationBotUserId: "U-GLASS-HOST",
    });
    await expect(
      t.mutation(prepareBatchFn, { eventIds: [claim.eventId] }),
    ).resolves.toMatchObject({ orgId: clientOrgId, channelId: "C-HOST" });
    await expect(
      t.mutation(claimInboundFn, {
        eventKey: "T-CUSTOMER:C-PRIMARY:1800000000.075:message",
        providerEventId: "Ev-customer-mirror",
        teamId: "T-CUSTOMER",
        channelId: "C-PRIMARY",
        threadTs: "1800000000.075",
        messageTs: "1800000000.075",
        senderUserId: "U-CUSTOMER",
        content: "<@U-GLASS> show my policy",
        eventType: "message",
        receivedAt: BASE_TIME,
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      t.query(getSendTargetFn, { connectionId, channelId: "C-HOST" }),
    ).resolves.toMatchObject({ teamId: "T-GLASS" });
    await expect(
      t.query(getSendTargetFn, { connectionId, channelId: "C-CUSTOMER-OTHER" }),
    ).resolves.toMatchObject({ teamId: "T-CUSTOMER" });

    const resolveClaim = (await t.mutation(claimInboundFn, {
      eventKey: "event-host-side-resolve",
      spectrumMessageId: "event-host-side-resolve",
      teamId: "T-GLASS",
      channelId: "C-HOST",
      threadTs: "1800000000.075",
      messageTs: "1800000000.076",
      senderUserId: "U-CUSTOMER",
      content: "<@U-GLASS-HOST> resolve",
      eventType: "message",
      receivedAt: BASE_TIME + 1,
    })) as { eventId: Id<"slackInboundEvents"> };
    await t.run(async (ctx) => {
      await ctx.db.patch(resolveClaim.eventId, { status: "processing" });
    });
    await t.mutation(enrichInboundActorFn, {
      eventId: resolveClaim.eventId,
      senderTeamId: "T-CUSTOMER",
      senderDisplayName: "Customer Admin",
      senderIsBot: false,
      installationBotUserId: "U-GLASS-HOST",
    });
    await expect(
      t.mutation(prepareBatchFn, { eventIds: [resolveClaim.eventId] }),
    ).resolves.toBeNull();
    const resolvedThread = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex(
          "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
          (q) =>
            q
              .eq("slackConnectionId", connectionId)
              .eq("slackChannelId", "C-PRIMARY")
              .eq("slackThreadTs", "1800000000.075"),
        )
        .unique(),
    );
    expect(resolvedThread?.slackState).toBe("resolved");
  });

  test("records primary messages and enforces mention, pause, resume, and resolve", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId } = await seedSlack(t);

    const quiet = await ingest(t, { eventKey: "event-1", content: "Hello" });
    expect(quiet.prepared).toBeNull();

    const mentioned = await ingest(t, {
      eventKey: "event-2",
      content: "<@U-GLASS> show my policy",
    });
    expect(mentioned.prepared).toMatchObject({ orgId: clientOrgId });

    const continued = await ingest(t, {
      eventKey: "event-3",
      content: "What is the limit?",
    });
    expect(continued.prepared).not.toBeNull();

    const paused = await ingest(t, {
      eventKey: "event-4",
      content: "I can help with this.",
      senderTeamId: "T-GLASS",
      senderUserId: "U-OPERATOR",
    });
    expect(paused.prepared).toBeNull();
    const whilePaused = await ingest(t, {
      eventKey: "event-5",
      content: "Thanks",
    });
    expect(whilePaused.prepared).toBeNull();

    const resumed = await ingest(t, {
      eventKey: "event-6",
      content: "<@U-GLASS> continue",
    });
    expect(resumed.prepared).not.toBeNull();
    const resolved = await ingest(t, {
      eventKey: "event-7",
      content: "<@U-GLASS> resolve",
    });
    expect(resolved.prepared).toBeNull();

    const state = await t.run(async (ctx) => {
      const threads = await ctx.db.query("threads").collect();
      const messages = await ctx.db.query("threadMessages").collect();
      return { threads, messages };
    });
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].slackState).toBe("resolved");
    expect(
      state.messages.filter((message) => message.role === "user"),
    ).toHaveLength(7);
  });

  test("treats an App Home DM as one private, mention-free conversation", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId } = await seedSlack(t);
    const glassUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Cove Admin",
        email: "admin@cove.test",
        accountKind: "customer",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId,
        role: "admin",
      });
      return userId;
    });

    const first = await ingest(t, {
      eventKey: "dm-1",
      channelId: "D-COVE-ADMIN",
      threadTs: "D-COVE-ADMIN",
      messageTs: "1800000001.100",
      senderDisplayName: "Cove Admin",
      senderEmail: "ADMIN@COVE.TEST",
      content: "Show my policy",
      isDirectMessage: true,
    });
    expect(first.prepared).toMatchObject({ orgId: clientOrgId });
    expect(first.prepared).not.toHaveProperty("threadTs");

    await t.run(async (ctx) => {
      const thread = await ctx.db.query("threads").first();
      if (!thread) throw new Error("DM thread fixture is missing");
      await ctx.db.patch(thread._id, { archivedAt: BASE_TIME });
    });

    const second = await ingest(t, {
      eventKey: "dm-2",
      channelId: "D-COVE-ADMIN",
      threadTs: "D-COVE-ADMIN",
      messageTs: "1800000002.100",
      senderDisplayName: "Cove Admin",
      senderEmail: "admin@cove.test",
      content: "What is the limit?",
      isDirectMessage: true,
    });
    expect(second.prepared).not.toBeNull();

    const state = await t.run(async (ctx) => ({
      threads: await ctx.db.query("threads").collect(),
      actors: await ctx.db.query("slackActors").collect(),
      messages: await ctx.db.query("threadMessages").collect(),
    }));
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0]).toMatchObject({
      title: "DM · Cove Admin",
      createdBy: glassUserId,
      visibility: "user_private",
      slackChannelId: "D-COVE-ADMIN",
      slackThreadTs: "D-COVE-ADMIN",
      slackConversationKind: "direct_message",
      slackState: "active",
    });
    expect(state.threads[0].archivedAt).toBeUndefined();
    expect(state.actors[0]).toMatchObject({ glassUserId });
    expect(
      state.messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
    expect(
      state.messages
        .filter((message) => message.role === "user")
        .every((message) => message.userId === glassUserId),
    ).toBe(true);
  });

  test("fails closed when mirroring a private non-support channel", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    const glassUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Private Channel Member",
        email: "private@cove.test",
        accountKind: "customer",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId,
        role: "member",
      });
      await ctx.db.insert("slackChannelMemberships", {
        connectionId,
        clientOrgId,
        channelId: "G-PRIVATE",
        channelName: "private-claims",
        isPrivate: true,
        isShared: false,
        status: "active",
        lastSyncedAt: BASE_TIME,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      });
      return userId;
    });

    const result = await ingest(t, {
      eventKey: "private-channel-1",
      channelId: "G-PRIVATE",
      threadTs: "1800000001.500",
      messageTs: "1800000001.500",
      senderDisplayName: "Private Channel Member",
      senderEmail: "private@cove.test",
      content: "<@U-GLASS> review this claim",
      isPrivateChannel: true,
    });
    expect(result.prepared).not.toBeNull();

    const thread = await t.run((ctx) => ctx.db.query("threads").first());
    expect(thread).toMatchObject({
      title: "#private-claims · Private Channel Member",
      createdBy: glassUserId,
      visibility: "user_private",
      slackConversationKind: "channel",
    });
  });

  test("ignores unrelated channel traffic until a mention opens an active thread", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedSlack(t);
    const threadTs = "1800000000.333";

    const quiet = await ingest(t, {
      eventKey: "off-channel-quiet",
      channelId: "C-POLICIES",
      threadTs,
      content: "Can someone review this?",
    });
    expect(quiet.claim).toMatchObject({ status: "ignored" });
    expect(quiet.claim.eventId).toBeUndefined();
    await expect(
      t.run((ctx) => ctx.db.query("slackInboundEvents").collect()),
    ).resolves.toHaveLength(0);

    const mentioned = await ingest(t, {
      eventKey: "off-channel-mentioned",
      channelId: "C-POLICIES",
      threadTs,
      content: "<@U-GLASS> review this policy",
    });
    expect(mentioned.prepared).not.toBeNull();
    const continued = await ingest(t, {
      eventKey: "off-channel-continued",
      channelId: "C-POLICIES",
      threadTs,
      content: "What about the deductible?",
    });
    expect(continued.prepared).not.toBeNull();

    const state = await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("threads")
        .withIndex(
          "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
          (q) =>
            q
              .eq("slackConnectionId", connectionId)
              .eq("slackChannelId", "C-POLICIES")
              .eq("slackThreadTs", threadTs),
        )
        .unique();
      return {
        thread,
        messages: thread
          ? await ctx.db
              .query("threadMessages")
              .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
              .collect()
          : [],
      };
    });
    expect(state.thread?.title).toBe("#C-POLICIES · U-CUSTOMER");
    expect(
      state.messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
  });

  test("rejects external invocations and creates content-free off-channel handoffs", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const external = await ingest(t, {
      eventKey: "external",
      channelId: "C-OTHER",
      content: "<@U-GLASS> expose the policy",
      senderTeamId: "T-VENDOR",
      senderUserId: "U-VENDOR",
    });
    expect(external.prepared).toBeNull();
    const afterExternal = await t.run(async (ctx) => ({
      messages: await ctx.db.query("threadMessages").collect(),
      threads: await ctx.db.query("threads").collect(),
      events: await ctx.db.query("slackInboundEvents").collect(),
    }));
    expect(afterExternal.messages).toHaveLength(0);
    expect(afterExternal.threads).toHaveLength(0);
    expect(afterExternal.events).toMatchObject([
      { status: "ignored", content: "" },
    ]);

    const handoff = await ingest(t, {
      eventKey: "handoff",
      channelId: "C-OTHER",
      content: "<@U-GLASS> human",
    });
    expect(handoff.prepared).toBeNull();
    const records = await t.run(async (ctx) => ({
      handoffs: await ctx.db.query("slackHandoffs").collect(),
      messages: await ctx.db.query("threadMessages").collect(),
    }));
    expect(records.handoffs).toHaveLength(1);
    expect(
      records.messages.filter((message) => message.role === "agent"),
    ).toHaveLength(0);

    const operatorInvocation = await ingest(t, {
      eventKey: "operator-invocation",
      channelId: "C-OPERATOR",
      content: "<@U-GLASS> summarize the policy",
      senderTeamId: "T-GLASS",
      senderUserId: "U-OPERATOR",
    });
    expect(operatorInvocation.prepared).not.toBeNull();
  });

  test("authorizes the actor before retrieving inbound files", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const claim = (await t.mutation(claimInboundFn, {
      eventKey: "external-file",
      teamId: "T-CUSTOMER",
      channelId: "C-OTHER",
      threadTs: "1800000000.399",
      messageTs: "1800000000.399",
      senderTeamId: "T-VENDOR",
      senderUserId: "U-VENDOR",
      content: "<@U-GLASS> inspect this",
      attachments: [
        {
          providerFileId: "F-EXTERNAL",
          filename: "external.pdf",
          contentType: "application/pdf",
          size: 1024,
        },
      ],
      eventType: "message",
      receivedAt: BASE_TIME,
    })) as { eventId: Id<"slackInboundEvents"> };
    await t.run((ctx) => ctx.db.patch(claim.eventId, { scheduledFor: 0 }));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/actor")) {
        return Response.json({
          teamId: "T-VENDOR",
          userId: "U-VENDOR",
          displayName: "Outside Vendor",
          isBot: false,
        });
      }
      throw new Error(`Unexpected attachment fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");

    await expect(
      t.action(processDebouncedFn, { eventId: claim.eventId }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/actor");
    const event = await t.run((ctx) => ctx.db.get(claim.eventId));
    expect(event).toMatchObject({
      status: "ignored",
      content: "",
    });
    expect(event?.attachment).toBeUndefined();
    expect(event?.attachments).toBeUndefined();
  });

  test("keeps same-timestamp messages and edits isolated by channel", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const messageTs = "1800000000.444";
    const first = await ingest(t, {
      eventKey: "channel-one-message",
      channelId: "C-ONE",
      threadTs: "1800000000.441",
      messageTs,
      content: "<@U-GLASS> channel one",
    });
    const second = await ingest(t, {
      eventKey: "channel-two-message",
      channelId: "C-TWO",
      threadTs: "1800000000.442",
      messageTs,
      content: "<@U-GLASS> channel two",
    });
    expect(first.claim.duplicate).toBe(false);
    expect(second.claim.duplicate).toBe(false);

    await ingest(t, {
      eventKey: "channel-one-edit",
      channelId: "C-ONE",
      threadTs: "1800000000.441",
      messageTs,
      content: "<@U-GLASS> corrected channel one",
      eventType: "edit",
    });
    const state = await t.run(async (ctx) => {
      const threads = await ctx.db.query("threads").collect();
      const messages = await ctx.db.query("threadMessages").collect();
      return threads.map((thread) => ({
        channelId: thread.slackChannelId,
        userContent: messages.find(
          (message) =>
            message.threadId === thread._id && message.role === "user",
        )?.content,
      }));
    });
    expect(state).toEqual(
      expect.arrayContaining([
        {
          channelId: "C-ONE",
          userContent: "<@U-GLASS> corrected channel one",
        },
        { channelId: "C-TWO", userContent: "<@U-GLASS> channel two" },
      ]),
    );
  });

  test("deduplicates events, debounces bursts, and records edits as revisions", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const first = await ingest(t, {
      eventKey: "duplicate",
      messageTs: "1800000000.111",
      content: "<@U-GLASS> first",
      receivedAt: BASE_TIME,
    });
    const duplicate = await t.mutation(claimInboundFn, {
      eventKey: "duplicate",
      spectrumMessageId: "duplicate",
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.000",
      messageTs: "1800000000.111",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      content: "<@U-GLASS> first",
      eventType: "message",
      receivedAt: BASE_TIME + 1,
    });
    expect(duplicate).toMatchObject({ duplicate: true });

    const burstOne = (await t.mutation(claimInboundFn, {
      eventKey: "burst-1",
      spectrumMessageId: "burst-1",
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.000",
      messageTs: "1800000000.211",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      content: "one more thought",
      eventType: "message",
      receivedAt: BASE_TIME + 400,
    })) as { eventId: Id<"slackInboundEvents"> };
    const secondClaim = (await t.mutation(claimInboundFn, {
      eventKey: "burst-2",
      spectrumMessageId: "burst-2",
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.000",
      messageTs: "1800000000.222",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      content: "and second",
      eventType: "message",
      receivedAt: BASE_TIME + 500,
    })) as { eventId: Id<"slackInboundEvents"> };
    const scheduled = await t.run(
      async (ctx) => await ctx.db.query("slackInboundEvents").collect(),
    );
    const burstEvents = scheduled.filter(
      (event) => event.eventKey === "burst-1" || event.eventKey === "burst-2",
    );
    expect(new Set(burstEvents.map((event) => event.scheduledFor)).size).toBe(
      1,
    );

    await t.mutation(prepareBatchFn, {
      eventIds: [burstOne.eventId, secondClaim.eventId],
    });
    const edit = await ingest(t, {
      eventKey: "edit",
      messageTs: "1800000000.111",
      content: "<@U-GLASS> corrected",
      eventType: "edit",
    });
    expect(edit.prepared).toBeNull();
    const revisions = await t.run(
      async (ctx) => await ctx.db.query("slackMessageRevisions").collect(),
    );
    expect(revisions).toMatchObject([
      {
        previousContent: "<@U-GLASS> first",
        revisedContent: "<@U-GLASS> corrected",
      },
    ]);
    expect(first.claim.status).toBe("queued");
  });

  test("scrubs deleted Slack messages and their retained revisions", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const messageTs = "1800000000.333";
    const original = await ingest(t, {
      eventKey: "delete-original",
      messageTs,
      content: "<@U-GLASS> sensitive details",
    });
    const attachmentId = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(["sensitive attachment"], { type: "text/plain" }),
      );
      const message = await ctx.db
        .query("threadMessages")
        .withIndex("by_slackTeamId_and_slackMessageTs", (q) =>
          q.eq("slackTeamId", "T-CUSTOMER").eq("slackMessageTs", messageTs),
        )
        .first();
      if (!message) throw new Error("Slack message fixture is missing");
      await ctx.db.patch(message._id, {
        attachments: [
          {
            fileId,
            filename: "sensitive.txt",
            contentType: "text/plain",
            size: 20,
          },
        ],
      });
      return fileId;
    });
    await ingest(t, {
      eventKey: "delete-edit",
      messageTs,
      content: "<@U-GLASS> corrected sensitive details",
      eventType: "edit",
    });
    const deleted = await ingest(t, {
      eventKey: "delete-event",
      messageTs,
      content: "",
      eventType: "delete",
      receivedAt: BASE_TIME + 1_000,
    });
    expect(original.prepared).not.toBeNull();
    expect(deleted.prepared).toBeNull();

    const state = await t.run(async (ctx) => ({
      messages: await ctx.db.query("threadMessages").collect(),
      events: await ctx.db.query("slackInboundEvents").collect(),
      revisions: await ctx.db.query("slackMessageRevisions").collect(),
      attachmentUrl: await ctx.storage.getUrl(attachmentId),
    }));
    expect(
      state.messages.find((message) => message.slackMessageTs === messageTs),
    ).toMatchObject({
      content: "Message deleted in Slack",
      slackDeletedAt: BASE_TIME + 1_000,
    });
    expect(
      state.messages.find((message) => message.slackMessageTs === messageTs)
        ?.attachments,
    ).toBeUndefined();
    expect(state.attachmentUrl).toBeNull();
    expect(
      state.events
        .filter((event) => event.messageTs === messageTs)
        .every((event) => event.content === ""),
    ).toBe(true);
    expect(state.revisions).toHaveLength(0);
  });

  test("ignores bot echoes and retries failed inbound processing three times", async () => {
    const t = convexTest(schema, modules);
    await seedSlack(t);
    const bot = await ingest(t, {
      eventKey: "bot-echo",
      content: "Glass response",
      senderUserId: "U-GLASS",
    });
    expect(bot.prepared).toBeNull();

    const claimed = (await t.mutation(claimInboundFn, {
      eventKey: "retry-event",
      spectrumMessageId: "retry-event",
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.900",
      messageTs: "1800000000.901",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      content: "<@U-GLASS> retry this",
      eventType: "message",
      receivedAt: BASE_TIME,
    })) as { eventId: Id<"slackInboundEvents"> };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await t.run((ctx) => ctx.db.patch(claimed.eventId, { scheduledFor: 0 }));
      await t.mutation(claimBatchFn, { eventId: claimed.eventId });
      await t.mutation(failEventsFn, {
        eventIds: [claimed.eventId],
        error: "temporary failure",
      });
      const event = await t.run((ctx) => ctx.db.get(claimed.eventId));
      expect(event?.attemptCount).toBe(attempt);
      expect(event?.status).toBe(attempt < 3 ? "queued" : "error");
    }
  });

  test("claims queued work even after more than fifty completed thread events", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedSlack(t);
    const channelId = "C-PRIMARY";
    const threadTs = "1800000000.950";
    await t.run(async (ctx) => {
      for (let index = 0; index < 55; index += 1) {
        await ctx.db.insert("slackInboundEvents", {
          eventKey: `historical-${index}`,
          canonicalEventKey: `historical-${index}`,
          connectionId,
          teamId: "T-CUSTOMER",
          channelId,
          threadTs,
          messageTs: `1799999999.${String(index).padStart(3, "0")}`,
          senderTeamId: "T-CUSTOMER",
          senderUserId: "U-CUSTOMER",
          content: "historical",
          eventType: "message",
          isPrimaryChannel: true,
          mentionsGlass: false,
          status: "completed",
          attemptCount: 1,
          receivedAt: index,
          scheduledFor: index,
          updatedAt: index,
        });
      }
    });
    const claim = (await t.mutation(claimInboundFn, {
      eventKey: "queued-after-history",
      teamId: "T-CUSTOMER",
      channelId,
      threadTs,
      messageTs: "1800000000.951",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      content: "<@U-GLASS> current",
      eventType: "message",
      receivedAt: BASE_TIME,
    })) as { eventId: Id<"slackInboundEvents"> };
    await t.run((ctx) => ctx.db.patch(claim.eventId, { scheduledFor: 0 }));

    const batch = await t.mutation(claimBatchFn, { eventId: claim.eventId });
    expect(
      batch.map((event: { _id: Id<"slackInboundEvents"> }) => event._id),
    ).toContain(claim.eventId);
  });

  test("does not infer a pending primary binding from a customer mention", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedSlack(t);
    await t.run(async (ctx) => {
      const binding = await ctx.db.query("slackChannelBindings").first();
      if (!binding) throw new Error("Primary binding fixture is missing");
      await ctx.db.patch(binding._id, { customerChannelId: undefined });
    });

    const external = await ingest(t, {
      eventKey: "external-bind-attempt",
      channelId: "C-VENDOR",
      content: "<@U-GLASS> hello",
      senderTeamId: "T-VENDOR",
      senderUserId: "U-VENDOR",
    });
    expect(external.prepared).toBeNull();
    const pendingBinding = await t.run((ctx) =>
      ctx.db.query("slackChannelBindings").first(),
    );
    expect(pendingBinding?.customerChannelId).toBeUndefined();

    const result = await ingest(t, {
      eventKey: "bind-primary",
      channelId: "C-CUSTOMER-SIDE",
      content: "<@U-GLASS> hello",
    });
    expect(result.prepared).not.toBeNull();
    const binding = await t.run((ctx) =>
      ctx.db.query("slackChannelBindings").first(),
    );
    expect(binding?.customerChannelId).toBeUndefined();

    await t.run(async (ctx) => {
      const activeBinding = await ctx.db.query("slackChannelBindings").first();
      if (activeBinding) await ctx.db.delete(activeBinding._id);
    });

    const noBindingHandoff = await ingest(t, {
      eventKey: "handoff-without-binding",
      channelId: "C-OTHER",
      threadTs: "1800000000.888",
      content: "<@U-GLASS> human",
    });
    expect(noBindingHandoff.prepared).toBeNull();
    const handoffState = await t.run(async (ctx) => ({
      handoffs: await ctx.db.query("slackHandoffs").collect(),
      thread: await ctx.db
        .query("threads")
        .withIndex(
          "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
          (q) =>
            q
              .eq("slackConnectionId", connectionId)
              .eq("slackChannelId", "C-OTHER")
              .eq("slackThreadTs", "1800000000.888"),
        )
        .first(),
    }));
    expect(handoffState.handoffs).toHaveLength(0);
    expect(handoffState.thread?.slackState).toBe("human_paused");
  });
});

describe("Slack setup and outbound durability", () => {
  test("OAuth state is org-bound, expiring, and single-use", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedSlack(t);
    const state = await t.mutation(createOAuthStateFn, {
      clientOrgId,
      userId: operatorUserId,
      actorKind: "operator",
    });
    const claimed = await t.mutation(claimOAuthStateFn, { state });
    expect(claimed).toMatchObject({
      clientOrgId,
      initiatedByOperatorUserId: operatorUserId,
    });
    await expect(t.mutation(claimOAuthStateFn, { state })).resolves.toBeNull();

    const expiredState = await t.mutation(createOAuthStateFn, {
      clientOrgId,
      userId: operatorUserId,
      actorKind: "operator",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("slackOAuthStates")
        .withIndex("by_stateHash")
        .filter((q) => q.eq(q.field("usedAt"), undefined))
        .first();
      if (!row) throw new Error("OAuth state fixture is missing");
      await ctx.db.patch(row._id, { expiresAt: 0 });
    });
    await expect(
      t.mutation(claimOAuthStateFn, { state: expiredState }),
    ).resolves.toBeNull();
  });

  test("enforces one active workspace per client and supports reinstall and disconnect", async () => {
    const t = convexTest(schema, modules);
    const clientOrgId = await t.run((ctx) =>
      ctx.db.insert("organizations", { name: "Client", type: "client" }),
    );
    const args = {
      clientOrgId,
      teamId: "T-ONE",
      teamName: "Client Slack",
      botUserId: "U-GLASS",
      grantedScopes: ["app_mentions:read"],
    };
    const connectionId = await t.mutation(upsertSlackConnectionFn, args);
    await t.run((ctx) =>
      ctx.db.insert("slackChannelBindings", {
        connectionId,
        clientOrgId,
        kind: "primary",
        hostTeamId: "T-GLASS",
        hostChannelId: "C-HOST",
        customerChannelId: "C-CUSTOMER",
        channelName: "glass-client",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      t.mutation(upsertSlackConnectionFn, { ...args, teamName: "Renamed" }),
    ).resolves.toBe(connectionId);
    await expect(
      t.mutation(upsertSlackConnectionFn, { ...args, teamId: "T-TWO" }),
    ).rejects.toThrow("already has an active Slack workspace");
    const actorUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Admin" }),
    );
    await t.mutation(disconnectInternalFn, {
      connectionId,
      actorUserId,
      actorKind: "client_admin",
    });
    const disconnected = await t.run((ctx) =>
      ctx.db.get("slackWorkspaceConnections", connectionId),
    );
    expect(disconnected?.status).toBe("disconnected");

    const reinstalledId = await t.mutation(upsertSlackConnectionFn, args);
    expect(reinstalledId).toBe(connectionId);
    const retainedBinding = await t.run((ctx) =>
      ctx.db.query("slackChannelBindings").first(),
    );
    expect(retainedBinding?.status).toBe("archived");
    await t.mutation(revokeByTeamIdFn, { teamId: "T-ONE" });
    const revoked = await t.run((ctx) =>
      ctx.db.get("slackWorkspaceConnections", reinstalledId),
    );
    expect(revoked?.status).toBe("revoked");
  });

  test("outbound keys deduplicate successes and retry failures at most three times", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    const args = {
      idempotencyKey: "policy:1:slack",
      orgId: clientOrgId,
      connectionId,
      channelId: "C-PRIMARY",
      content: "Policy attached",
    };
    const first = await t.mutation(claimOutboundFn, args);
    await t.mutation(markSentFn, {
      id: first.row._id,
      providerMessageId: "1800.1",
    });
    const duplicate = await t.mutation(claimOutboundFn, args);
    expect(duplicate.send).toBe(false);

    const failed = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "failure",
    });
    await t.mutation(markFailedFn, {
      id: failed.row._id,
      error: "timeout",
      retry: true,
    });
    const retryTwo = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "failure",
    });
    await t.mutation(markFailedFn, {
      id: retryTwo.row._id,
      error: "timeout",
      retry: true,
    });
    const retryThree = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "failure",
    });
    await expect(
      t.mutation(markFailedFn, {
        id: retryThree.row._id,
        error: "timeout",
        retry: true,
      }),
    ).resolves.toBeNull();
    const exhausted = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "failure",
    });
    expect(exhausted.send).toBe(false);

    const stalled = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "stalled",
    });
    await t.run((ctx) =>
      ctx.db.patch(stalled.row._id, {
        updatedAt: dayjs().subtract(6, "minute").valueOf(),
      }),
    );
    const reclaimed = await t.mutation(claimOutboundFn, {
      ...args,
      idempotencyKey: "stalled",
    });
    expect(reclaimed).toMatchObject({
      send: true,
      row: { attemptCount: 2, status: "sending" },
    });
  });

  test("records a terminal block before transport when Slack health is degraded", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    await t.run((ctx) =>
      ctx.db.patch(connectionId, {
        healthStatus: "degraded",
        healthReason: "verification_failed",
      }),
    );
    const claim = await t.mutation(claimOutboundFn, {
      idempotencyKey: "blocked-health",
      orgId: clientOrgId,
      connectionId,
      channelId: "C-PRIMARY",
      content: "Do not send",
    });
    expect(claim).toMatchObject({
      send: false,
      row: {
        status: "blocked",
        attemptCount: 0,
        retryable: false,
        failureReason: "target_unavailable",
      },
    });
    await expect(
      t.mutation(claimOutboundFn, {
        idempotencyKey: "blocked-health",
        orgId: clientOrgId,
        connectionId,
        channelId: "C-PRIMARY",
        content: "Do not send",
      }),
    ).resolves.toMatchObject({ send: false, row: { status: "blocked" } });
  });

  test("surfaces terminal Slack delivery failure on the mirrored agent message", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId, serviceUserId } = await seedSlack(t);
    const { threadId, messageId } = await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "#insurance-support · Customer",
        createdBy: serviceUserId,
        lastMessageAt: BASE_TIME,
        originChannel: "slack",
        slackConnectionId: connectionId,
        slackChannelId: "C-PRIMARY",
        slackThreadTs: "1800000000.800",
        slackConversationKind: "channel",
        slackState: "active",
      });
      const messageId = await ctx.db.insert("threadMessages", {
        threadId,
        orgId: clientOrgId,
        channel: "slack",
        role: "agent",
        content: "Here is the answer.",
      });
      return { threadId, messageId };
    });
    const args = {
      idempotencyKey: "agent:delivery-state",
      orgId: clientOrgId,
      connectionId,
      threadId,
      threadMessageId: messageId,
      channelId: "C-PRIMARY",
      threadTs: "1800000000.800",
      content: "Here is the answer.",
    };

    let claim = await t.mutation(claimOutboundFn, args);
    await expect(t.run((ctx) => ctx.db.get(messageId))).resolves.toMatchObject({
      slackDeliveryStatus: "sending",
    });
    await t.mutation(markFailedFn, {
      id: claim.row._id,
      error: "timeout",
      retry: true,
    });
    claim = await t.mutation(claimOutboundFn, args);
    await t.mutation(markFailedFn, {
      id: claim.row._id,
      error: "timeout",
      retry: true,
    });
    claim = await t.mutation(claimOutboundFn, args);
    await t.mutation(markFailedFn, {
      id: claim.row._id,
      error: "channel_not_found",
      retry: true,
    });

    await expect(t.run((ctx) => ctx.db.get(messageId))).resolves.toMatchObject({
      slackDeliveryStatus: "failed",
      slackDeliveryError: "channel_not_found",
    });
  });

  test("honors Slack Retry-After when scheduling an outbound retry", async () => {
    vi.setSystemTime(BASE_TIME);
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    const claim = await t.mutation(claimOutboundFn, {
      idempotencyKey: "rate-limited",
      orgId: clientOrgId,
      connectionId,
      channelId: "C-PRIMARY",
      content: "Retry later",
    });
    await expect(
      t.mutation(markFailedFn, {
        id: claim.row._id,
        error: "ratelimited; retry after 60s",
        retry: true,
      }),
    ).resolves.toBe(BASE_TIME + 60_000);
  });

  test("rejects outbound sends whose org, connection, or thread disagree", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId, serviceUserId } = await seedSlack(t);
    const { otherOrgId, otherThreadId } = await t.run(async (ctx) => {
      const otherOrgId = await ctx.db.insert("organizations", {
        name: "Other Client",
        type: "client",
      });
      const otherThreadId = await ctx.db.insert("threads", {
        orgId: otherOrgId,
        title: "Other Slack thread",
        createdBy: serviceUserId,
        lastMessageAt: 1,
        originChannel: "slack",
        slackConnectionId: connectionId,
        slackChannelId: "C-OTHER",
        slackThreadTs: "1800000000.999",
        slackState: "active",
      });
      return { otherOrgId, otherThreadId };
    });
    const base = {
      connectionId,
      channelId: "C-PRIMARY",
      content: "Do not cross tenant boundaries",
    };
    await expect(
      t.mutation(claimOutboundFn, {
        ...base,
        idempotencyKey: "cross-org",
        orgId: otherOrgId,
      }),
    ).rejects.toThrow("Slack connection does not belong to the organization");
    await expect(
      t.mutation(claimOutboundFn, {
        ...base,
        idempotencyKey: "cross-thread",
        orgId: clientOrgId,
        threadId: otherThreadId,
      }),
    ).rejects.toThrow("Slack thread does not belong to the connection");

    const validThreadId = await t.run((ctx) =>
      ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "#insurance-support · Customer",
        createdBy: serviceUserId,
        lastMessageAt: BASE_TIME,
        originChannel: "slack",
        slackConnectionId: connectionId,
        slackChannelId: "C-PRIMARY",
        slackThreadTs: "1800000000.555",
        slackConversationKind: "channel",
        slackState: "active",
      }),
    );
    await expect(
      t.mutation(claimOutboundFn, {
        ...base,
        idempotencyKey: "wrong-channel",
        orgId: clientOrgId,
        threadId: validThreadId,
        channelId: "C-OTHER",
        threadTs: "1800000000.555",
      }),
    ).rejects.toThrow("does not match the thread channel");
    await expect(
      t.mutation(claimOutboundFn, {
        ...base,
        idempotencyKey: "wrong-thread",
        orgId: clientOrgId,
        threadId: validThreadId,
        threadTs: "1800000000.999",
      }),
    ).rejects.toThrow("does not match the thread timestamp");
  });

  test("records a file-bearing policy delivery as one canonical Slack thread", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedSlack(t);
    const { fileId, policyId } = await t.run(async (ctx) => ({
      fileId: await ctx.storage.store(
        new Blob(["policy"], { type: "application/pdf" }),
      ),
      policyId: await ctx.db.insert("policies", {
        orgId: clientOrgId,
        carrier: "Fixture Carrier",
        policyNumber: "SLACK-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      }),
    }));
    const args = {
      orgId: clientOrgId,
      connectionId,
      channelId: "C-PRIMARY",
      threadTs: "1800000000.700",
      content: "Your policy is ready.",
      attachment: {
        fileId,
        filename: "policy.pdf",
        contentType: "application/pdf",
        size: 6,
      },
      policyId,
      idempotencyKey: "policy-delivery:fixture",
    };
    const threadId = await t.mutation(createDeliveryRecordFn, args);
    await expect(t.mutation(createDeliveryRecordFn, args)).resolves.toBe(
      threadId,
    );
    const records = await t.run(async (ctx) => ({
      threads: await ctx.db.query("threads").collect(),
      messages: await ctx.db.query("threadMessages").collect(),
    }));
    expect(records.threads).toHaveLength(1);
    expect(records.messages).toMatchObject([
      {
        channel: "slack",
        attachments: [{ fileId, filename: "policy.pdf" }],
        referencedPolicyIds: [policyId],
      },
    ]);
  });

  test("schedules safe alerts and keeps vendor alerts off by default", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId } = await seedSlack(t);
    const notify = (type: string) =>
      t.mutation(notifyInternalFn, {
        orgId: clientOrgId,
        type,
        title: "Attention needed",
        body: "Review the client record.",
        nowMs: BASE_TIME,
      });
    await notify("own_compliance_gap");
    await notify("vendor_compliance_gap");
    await notify("mailbox_attention");
    const statuses = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(statuses.map((row) => row?.slackStatus)).toEqual([
      "scheduled",
      "suppressed_by_preference",
      "not_scheduled",
    ]);
  });
});
