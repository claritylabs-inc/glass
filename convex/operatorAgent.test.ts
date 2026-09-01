/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import { slackThreadContextText } from "./lib/slackThreadContext";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

async function seedOperatorAgentFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const firstOperatorUserId = await ctx.db.insert("users", {
      name: "First Operator",
      email: "first-operator@example.com",
      accountKind: "operator",
    });
    const secondOperatorUserId = await ctx.db.insert("users", {
      name: "Second Operator",
      email: "second-operator@example.com",
      accountKind: "operator",
    });
    await Promise.all([
      ctx.db.insert("operatorProfiles", {
        userId: firstOperatorUserId,
        email: "first-operator@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      ctx.db.insert("operatorProfiles", {
        userId: secondOperatorUserId,
        email: "second-operator@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const orgId = await ctx.db.insert("organizations", {
      name: "Operator Agent Client",
      type: "client",
      operatorStatus: "onboarding",
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Northwoods Continental Insurance Company",
      policyNumber: "NWC-TEC-3110-26-01",
      linesOfBusiness: ["CGL"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Operator Agent Client",
      pipelineStatus: "complete",
      extractionDataStage: "final",
    });
    return { firstOperatorUserId, secondOperatorUserId, orgId, policyId };
  });
  return { t, ...ids };
}

describe("operator agent boundary", () => {
  test("reports whether a channel thread was newly created", async () => {
    const fixture = await seedOperatorAgentFixture();
    const args = {
      operatorUserId: fixture.firstOperatorUserId,
      channel: "slack" as const,
      conversationKey: "T-CLARITY:C-RENEWALS:thread-title",
      title: "#renewals",
      shared: true,
    };

    const created = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadWithStatusInternal,
      args,
    );
    const existing = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadWithStatusInternal,
      args,
    );

    expect(created).toMatchObject({ created: true, title: "#renewals" });
    expect(existing).toEqual({
      threadId: created.threadId,
      created: false,
      title: "#renewals",
    });
  });

  test("shares private Slack channel threads without sharing DMs", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const secondOperator = fixture.t.withIdentity({
      subject: `${fixture.secondOperatorUserId}|session`,
    });
    const conversationKey = "T-CLARITY:C-PRIVATE:thread-1";
    const firstSharedThread = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "slack",
        conversationKey,
        shared: true,
      },
    );
    const secondSharedThread = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.secondOperatorUserId,
        channel: "slack",
        conversationKey,
        shared: true,
      },
    );
    expect(secondSharedThread).toBe(firstSharedThread);

    await fixture.t.mutation(internal.operatorAgent.enqueueMessageInternal, {
      operatorUserId: fixture.secondOperatorUserId,
      threadId: secondSharedThread,
      channel: "slack",
      content: "Check this shared channel task.",
      dedupeKey: `operator:${conversationKey}:1800000000.100`,
      slackThreadContext: {
        messages: [
          {
            messageTs: "1800000000.000",
            senderUserId: "U-FIRST",
            content: "Original quote requirements for Sigillo Supply",
          },
          {
            messageTs: "1800000000.100",
            senderUserId: "U-SECOND",
            content: "Check this shared channel task.",
          },
        ],
        truncated: false,
      },
    });
    const sharedThread = await secondOperator.query(
      api.operatorAgent.getThread,
      { threadId: firstSharedThread },
    );
    expect(sharedThread).toMatchObject({
      thread: { visibility: "shared", channel: "slack" },
    });
    const userMessage = sharedThread.messages.find(
      (message) => message.role === "user",
    );
    expect(slackThreadContextText(userMessage?.toolArtifacts)).toContain(
      "Original quote requirements for Sigillo Supply",
    );
    expect(slackThreadContextText(userMessage?.toolArtifacts)).not.toContain(
      "Check this shared channel task.",
    );
    await expect(
      firstOperator.query(api.operatorAgent.listThreads, { limit: 20 }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: firstSharedThread }),
      ]),
    );

    const firstDm = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "slack",
        conversationKey: "T-CLARITY:D-OPERATOR:root",
      },
    );
    const secondDm = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.secondOperatorUserId,
        channel: "slack",
        conversationKey: "T-CLARITY:D-OPERATOR:root",
      },
    );
    expect(secondDm).not.toBe(firstDm);
  });

  test("retains the thread origin context across later page changes", async () => {
    const fixture = await seedOperatorAgentFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const policyContext = {
      pageType: "policy",
      entityId: "policy-origin-id",
      summary: "Origin policy",
    };
    const threadId = await operator.mutation(api.operatorAgent.createThread, {
      initialContext: policyContext,
    });

    await operator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Generate a COI for this policy.",
      pageContext: policyContext,
    });
    await operator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Try again from here.",
      pageContext: {
        pageType: "operator_clients",
        entityId: String(fixture.orgId),
        summary: "Client organizations",
      },
    });

    await expect(
      operator.query(api.operatorAgent.getThread, { threadId }),
    ).resolves.toMatchObject({
      thread: { initialContext: policyContext },
    });
  });

  test("separates archived threads and restores them on new activity", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const secondOperator = fixture.t.withIdentity({
      subject: `${fixture.secondOperatorUserId}|session`,
    });
    const threadId = await firstOperator.mutation(
      api.operatorAgent.createThread,
      {},
    );

    await firstOperator.mutation(api.operatorAgent.archiveThread, { threadId });
    await expect(
      firstOperator.query(api.operatorAgent.listThreads, {
        limit: 20,
        archived: false,
      }),
    ).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: threadId })]),
    );
    await expect(
      firstOperator.query(api.operatorAgent.listThreads, {
        limit: 20,
        archived: true,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: threadId,
          archiveState: "archived",
          archivedAt: expect.any(Number),
        }),
      ]),
    );
    await expect(
      secondOperator.mutation(api.operatorAgent.unarchiveThread, { threadId }),
    ).rejects.toThrow("Operator thread not found");

    await firstOperator.mutation(api.operatorAgent.unarchiveThread, {
      threadId,
    });
    await expect(
      firstOperator.query(api.operatorAgent.listThreads, {
        limit: 20,
        archived: false,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: threadId })]),
    );

    await firstOperator.mutation(api.operatorAgent.archiveThread, { threadId });
    await firstOperator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Continue this archived task.",
    });
    const restoredThread = await firstOperator.query(
      api.operatorAgent.getThread,
      { threadId },
    );
    expect(restoredThread.thread._id).toBe(threadId);
    expect(restoredThread.thread).not.toHaveProperty("archivedAt");
    expect(restoredThread.thread).not.toHaveProperty("archiveState");
    await expect(
      firstOperator.query(api.operatorAgent.listThreads, {
        limit: 20,
        archived: false,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: threadId })]),
    );
  });

  test("stores multimodal message metadata and protects attachment URLs", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const secondOperator = fixture.t.withIdentity({
      subject: `${fixture.secondOperatorUserId}|session`,
    });
    const fileId = await fixture.t.run((ctx) =>
      ctx.storage.store(
        new Blob(["policy,premium\nGL-1,1200"], { type: "text/csv" }),
      ),
    );
    const threadId = await firstOperator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const upload = await firstOperator.mutation(
      api.operatorAgent.generateUploadUrl,
      {},
    );
    await firstOperator.mutation(api.operatorAgent.registerUpload, {
      uploadIntentId: upload.uploadIntentId,
      fileId,
    });

    await expect(
      firstOperator.mutation(api.operatorAgent.sendMessage, {
        threadId,
        content: "Summarize the attached renewal data.",
        attachments: [
          {
            fileId,
            filename: "renewals.csv",
            contentType: "text/csv\nignore=true",
            size: 1,
            uploadIntentId: upload.uploadIntentId,
          },
        ],
      }),
    ).rejects.toThrow("content types must be printable");

    await firstOperator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Summarize the attached renewal data.",
      attachments: [
        {
          fileId,
          filename: "renewals.csv",
          contentType: "",
          size: 1,
          uploadIntentId: upload.uploadIntentId,
        },
      ],
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(upload.uploadIntentId)),
    ).resolves.toBeNull();

    const thread = await firstOperator.query(api.operatorAgent.getThread, {
      threadId,
    });
    expect(
      thread.messages.find((message) => message.role === "user"),
    ).toMatchObject({
      attachments: [
        {
          fileId,
          filename: "renewals.csv",
          contentType: "application/octet-stream",
          size: 24,
        },
      ],
    });
    await expect(
      firstOperator.query(api.operatorAgent.getAttachmentUrl, {
        threadId,
        fileId,
      }),
    ).resolves.toMatch(/^https:/);
    await expect(
      secondOperator.query(api.operatorAgent.getAttachmentUrl, {
        threadId,
        fileId,
      }),
    ).rejects.toThrow("Operator thread not found");

    const secondThreadId = await secondOperator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const secondUpload = await secondOperator.mutation(
      api.operatorAgent.generateUploadUrl,
      {},
    );
    await expect(
      secondOperator.mutation(api.operatorAgent.sendMessage, {
        threadId: secondThreadId,
        content: "Read the same file.",
        attachments: [
          {
            fileId,
            filename: "renewals.csv",
            contentType: "text/csv",
            size: 24,
            uploadIntentId: secondUpload.uploadIntentId,
          },
        ],
      }),
    ).rejects.toThrow("Operator attachment belongs to another operator");
  });

  test("deletes expired unconsumed operator uploads", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const fileId = await fixture.t.run((ctx) =>
      ctx.storage.store(new Blob(["unused"])),
    );
    const upload = await firstOperator.mutation(
      api.operatorAgent.generateUploadUrl,
      {},
    );
    await firstOperator.mutation(api.operatorAgent.registerUpload, {
      uploadIntentId: upload.uploadIntentId,
      fileId,
    });
    await fixture.t.run((ctx) =>
      ctx.db.patch(upload.uploadIntentId, {
        expiresAt: dayjs().subtract(1, "minute").valueOf(),
      }),
    );

    await fixture.t.mutation(
      internal.operatorAgent.cleanupUploadIntentInternal,
      { uploadIntentId: upload.uploadIntentId },
    );

    await expect(
      fixture.t.run((ctx) => ctx.db.get(upload.uploadIntentId)),
    ).resolves.toBeNull();
    await expect(
      fixture.t.run((ctx) => ctx.storage.get(fileId)),
    ).resolves.toBeNull();
  });

  test("discards a blob when upload registration fails", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const fileId = await fixture.t.run((ctx) =>
      ctx.storage.store(new Blob(["partial upload"])),
    );
    const upload = await firstOperator.mutation(
      api.operatorAgent.generateUploadUrl,
      {},
    );

    await firstOperator.mutation(api.operatorAgent.discardUploads, {
      uploads: [{ uploadIntentId: upload.uploadIntentId, fileId }],
    });

    await expect(
      fixture.t.run((ctx) => ctx.storage.get(fileId)),
    ).resolves.toBeNull();
    await expect(
      fixture.t.run((ctx) => ctx.db.get(upload.uploadIntentId)),
    ).resolves.toBeNull();
  });

  test("isolates ownership and applies exact-confirmed writes idempotently", async () => {
    const fixture = await seedOperatorAgentFixture();
    const firstOperator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const secondOperator = fixture.t.withIdentity({
      subject: `${fixture.secondOperatorUserId}|session`,
    });
    const threadId = await firstOperator.mutation(
      api.operatorAgent.createThread,
      {},
    );

    await expect(
      secondOperator.query(api.operatorAgent.getThread, { threadId }),
    ).rejects.toThrow("Operator thread not found");

    const readResult = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "get_organization",
        input: { orgId: fixture.orgId },
        idempotencyKey: "read-organization-once",
      },
    );
    expect(readResult.outcome).toMatchObject({
      status: "succeeded",
      result: { orgId: fixture.orgId, name: "Operator Agent Client" },
    });
    await expect(
      fixture.t.query(internal.operatorAgent.getRunResultForOperatorInternal, {
        operatorUserId: fixture.secondOperatorUserId,
        runId: readResult.runId,
      }),
    ).rejects.toThrow("Operator agent run not found");

    const writeInput = { orgId: fixture.orgId, status: "live" as const };
    const writeResult = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "set_organization_status",
        input: writeInput,
        idempotencyKey: "set-organization-live-once",
      },
    );
    expect(writeResult.outcome.status).toBe("confirmation_required");
    if (
      writeResult.outcome.status !== "confirmation_required" ||
      !writeResult.outcome.confirmationId
    ) {
      throw new Error("Expected exact operator confirmation");
    }
    const confirmationId = writeResult.outcome.confirmationId;
    const pending = await fixture.t.run((ctx) => ctx.db.get(confirmationId));
    expect(pending?.payload.kind).toBe("operator_tool_action");
    if (pending?.payload.kind !== "operator_tool_action") {
      throw new Error("Expected operator tool payload");
    }
    expect(pending.payload.summary).toBe(
      "Set organization Operator Agent Client status to live",
    );
    expect(pending.payload.summary).not.toContain(String(fixture.orgId));
    const browserThread = await firstOperator.query(
      api.operatorAgent.getThread,
      {
        threadId,
      },
    );
    expect(browserThread).toMatchObject({
      confirmations: [
        {
          _id: confirmationId,
          promptMessageId: pending.promptMessageId,
          summary: "Set organization Operator Agent Client status to live",
          state: "pending",
          actionable: true,
        },
      ],
    });
    expect(
      browserThread.messages.find(
        (message) =>
          message.role === "user" &&
          message.content.startsWith("Set organization"),
      )?.content,
    ).toBe("Set organization Operator Agent Client status to live");
    expect(
      browserThread.messages.every(
        (message) => !message.content.includes(String(fixture.orgId)),
      ),
    ).toBe(true);
    await expect(
      actionConfirmationFingerprint({
        toolName: "set_organization_status",
        toolVersion: 1,
        input: writeInput,
      }),
    ).resolves.toBe(pending.payload.inputHash);

    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    const approvedBrowserThread = await firstOperator.query(
      api.operatorAgent.getThread,
      { threadId },
    );
    expect(approvedBrowserThread.confirmations).toContainEqual(
      expect.objectContaining({
        _id: confirmationId,
        promptMessageId: pending.promptMessageId,
        state: "approved",
        actionable: false,
      }),
    );
    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId,
        decision: "reject",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "needs_refresh" });

    const replay = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "set_organization_status",
        input: writeInput,
        idempotencyKey: "set-organization-live-once",
      },
    );
    expect(replay.outcome).toMatchObject({
      status: "succeeded",
      idempotent: true,
    });

    const abandonedWrite = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "set_organization_status",
        input: { orgId: fixture.orgId, status: "onboarding" },
        idempotencyKey: "set-organization-onboarding-abandoned",
      },
    );
    if (
      abandonedWrite.outcome.status !== "confirmation_required" ||
      !abandonedWrite.outcome.confirmationId
    ) {
      throw new Error("Expected pending confirmation before run failure");
    }
    const abandonedConfirmationId = abandonedWrite.outcome.confirmationId;
    await fixture.t.mutation(internal.operatorAgent.failRunInternal, {
      runId: abandonedWrite.runId,
      error: "runner stopped",
    });
    const abandoned = await fixture.t.run(async (ctx) => ({
      run: await ctx.db.get(abandonedWrite.runId),
      confirmation: await ctx.db.get(abandonedConfirmationId),
    }));
    expect(abandoned.run).toMatchObject({
      status: "failed",
      checkpoint: { summary: "Operator run failed" },
    });
    expect(abandoned.run?.checkpoint?.pendingConfirmationId).toBeUndefined();
    expect(abandoned.confirmation).toMatchObject({
      status: "stale",
      invalidationReason: "operator_run_failed",
    });

    const persisted = await fixture.t.run(async (ctx) => ({
      organization: await ctx.db.get(fixture.orgId),
      ledgers: await ctx.db
        .query("agentActionAuditEvents")
        .withIndex("idempotency", (index) =>
          index
            .eq("operatorUserId", fixture.firstOperatorUserId)
            .eq("idempotencyKey", "set-organization-live-once"),
        )
        .collect(),
    }));
    expect(persisted.organization?.operatorStatus).toBe("live");
    expect(persisted.ledgers).toHaveLength(1);
    expect(persisted.ledgers[0]).toMatchObject({ status: "succeeded" });
  });

  test("finds legacy client organizations by a close human-readable name", async () => {
    const fixture = await seedOperatorAgentFixture();
    const sigilloOrgId = await fixture.t.run((ctx) =>
      ctx.db.insert("organizations", { name: "Sigillo Supply" }),
    );
    const threadId = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "mcp",
        conversationKey: "mcp:organization-search-test",
      },
    );

    const result = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "search_organizations",
        input: { query: "Siggilo Supply", type: "client" },
        idempotencyKey: "search-siggilo-supply",
      },
    );
    expect(result.outcome).toMatchObject({
      status: "succeeded",
      result: [
        {
          orgId: sigilloOrgId,
          name: "Sigillo Supply",
          type: "client",
        },
      ],
    });
  });

  test("validates procurement policy links before requesting confirmation", async () => {
    const fixture = await seedOperatorAgentFixture();
    const threadId = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "slack",
        conversationKey: "T-CLARITY:C-PROCUREMENT:root",
        shared: true,
      },
    );
    const input = {
      orgId: fixture.orgId,
      title:
        "1305 Carroll Avenue Building Purchase — Property, Liability & Earthquake",
      requestSummary: "Arrange coverage for the new building purchase.",
      requirements: "Property, liability, and earthquake coverage.",
    };
    const invalid = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "slack",
        toolName: "create_procurement_request",
        input: { ...input, replacingPolicyId: fixture.orgId },
        idempotencyKey: "invalid-procurement-policy-link",
      },
    );
    expect(invalid.outcome).toEqual({
      status: "failed",
      error:
        "replacingPolicyId must be an exact policy ID returned by a policy read tool; omit it when no policy is being linked",
    });
    await expect(
      fixture.t.run(async (ctx) =>
        ctx.db
          .query("operatorAgentConfirmations")
          .withIndex("thread_status", (index) =>
            index.eq("threadId", threadId).eq("status", "pending"),
          )
          .first(),
      ),
    ).resolves.toBeNull();

    const requested = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "slack",
        toolName: "create_procurement_request",
        input,
        idempotencyKey: "valid-procurement-request",
      },
    );
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    ) {
      throw new Error("Expected exact procurement confirmation");
    }
    expect(requested.outcome.summary).toContain("Operator Agent Client");
    expect(requested.outcome.summary).not.toContain(String(fixture.orgId));
    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId: requested.outcome.confirmationId,
        decision: "approve",
        channel: "slack",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    const request = await fixture.t.run((ctx) =>
      ctx.db
        .query("procurementRequests")
        .withIndex("organization", (index) =>
          index.eq("clientOrgId", fixture.orgId),
        )
        .first(),
    );
    expect(request).toMatchObject({ title: input.title });
    expect(request).not.toHaveProperty("replacingPolicyId");
    expect(request).not.toHaveProperty("resultingPolicyId");
  });

  test("approval queues action-backed COI generation without bypassing confirmation", async () => {
    vi.useFakeTimers();
    const fixture = await seedOperatorAgentFixture();
    const threadId = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "mcp",
        conversationKey: "mcp:certificate-test",
      },
    );
    const requested = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "generate_coi",
        input: {
          policyId: fixture.policyId,
          certificateHolder: "ReLease Coverage Company Inc.",
          holderContactName: "Terry Wang",
        },
        idempotencyKey: "generate-release-coi-once",
      },
    );
    expect(requested.outcome.status).toBe("confirmation_required");
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    ) {
      throw new Error("Expected exact COI confirmation");
    }
    const confirmationId = requested.outcome.confirmationId;

    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "queued" });

    const state = await fixture.t.run(async (ctx) => ({
      confirmation: await ctx.db.get(confirmationId),
      run: await ctx.db.get(requested.runId),
      response: await ctx.db.get(requested.agentMessageId),
      ledger: await ctx.db
        .query("agentActionAuditEvents")
        .withIndex("idempotency", (index) =>
          index
            .eq("operatorUserId", fixture.firstOperatorUserId)
            .eq("idempotencyKey", "generate-release-coi-once"),
        )
        .unique(),
    }));
    expect(state.confirmation).toMatchObject({ status: "completed" });
    expect(state.run).toMatchObject({ status: "running" });
    expect(state.response).toMatchObject({ content: "", status: "processing" });
    expect(state.ledger).toMatchObject({
      action: "generate_coi",
      capability: "operator.certificates.write",
      status: "pending",
    });

    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    const completed = await fixture.t.run(async (ctx) => ({
      run: await ctx.db.get(requested.runId),
      response: await ctx.db.get(requested.agentMessageId),
      ledger: await ctx.db
        .query("agentActionAuditEvents")
        .withIndex("idempotency", (index) =>
          index
            .eq("operatorUserId", fixture.firstOperatorUserId)
            .eq("idempotencyKey", "generate-release-coi-once"),
        )
        .unique(),
    }));
    expect(completed.run).toMatchObject({ status: "completed" });
    expect(completed.response).toMatchObject({
      content: expect.stringContaining("Completed: Generate COI"),
      attachments: [
        expect.objectContaining({
          filename: expect.stringMatching(/\.pdf$/),
          contentType: "application/pdf",
        }),
      ],
    });
    expect(completed.ledger).toMatchObject({ status: "succeeded" });
    await expect(
      fixture.t.action(
        internal.operatorAgent.executeConfirmedActionToolInternal,
        { runId: requested.runId, confirmationId },
      ),
    ).resolves.toMatchObject({
      result: { status: "succeeded", idempotent: true },
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(completed.ledger!._id)),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  test("resumes a goal run after an exact-confirmed write", async () => {
    const fixture = await seedOperatorAgentFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const threadId = await operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const queued = await operator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Set this client live, then verify its current status.",
    });
    await fixture.t.mutation(internal.operatorAgent.markRunStartedInternal, {
      runId: queued.runId,
    });
    const input = { orgId: fixture.orgId, status: "live" as const };
    const inputHash = await actionConfirmationFingerprint({
      toolName: "set_organization_status",
      toolVersion: 1,
      input,
    });
    const requested = await fixture.t.mutation(
      internal.operatorAgent.requestToolConfirmationInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        runId: queued.runId,
        threadId,
        threadMessageId: (
          await fixture.t.query(
            internal.operatorAgent.getRunResultForOperatorInternal,
            {
              operatorUserId: fixture.firstOperatorUserId,
              runId: queued.runId,
            },
          )
        ).run.agentMessageId,
        toolName: "set_organization_status",
        input,
        inputHash,
        idempotencyKey: `${queued.runId}:set_organization_status:${inputHash}`,
        channel: "chat",
      },
    );
    if (
      requested.status !== "confirmation_required" ||
      !requested.confirmationId
    ) {
      throw new Error("Expected an exact confirmation");
    }

    await expect(
      operator.mutation(api.operatorAgent.confirmAction, {
        threadId,
        confirmationId: requested.confirmationId,
        decision: "approve",
      }),
    ).resolves.toMatchObject({ status: "queued" });

    const state = await fixture.t.run(async (ctx) => ({
      organization: await ctx.db.get(fixture.orgId),
      run: await ctx.db.get(queued.runId),
      response: await ctx.db.get(
        (await ctx.db.get(queued.runId))!.agentMessageId,
      ),
    }));
    expect(state.organization?.operatorStatus).toBe("live");
    expect(state.run).toMatchObject({
      executionKind: "goal",
      status: "queued",
      checkpoint: {
        lastToolName: "set_organization_status",
      },
    });
    expect(state.run?.checkpoint?.pendingConfirmationId).toBeUndefined();
    expect(state.run?.checkpoint?.summary).toContain(
      "Tool set_organization_status",
    );
    expect(state.response).toMatchObject({ content: "", status: "processing" });
  });

  test("files an exact thread attachment privately without confirmation", async () => {
    const fixture = await seedOperatorAgentFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const fileId = await fixture.t.run((ctx) =>
      ctx.storage.store(
        new Blob(["Roof report for 123 Main Street"], {
          type: "application/pdf",
        }),
      ),
    );
    const threadId = await operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const upload = await operator.mutation(
      api.operatorAgent.generateUploadUrl,
      {},
    );
    await operator.mutation(api.operatorAgent.registerUpload, {
      uploadIntentId: upload.uploadIntentId,
      fileId,
    });
    await operator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Add this roof report to the current client.",
      attachments: [
        {
          fileId,
          filename: "scan-004.pdf",
          contentType: "application/pdf",
          size: 31,
          uploadIntentId: upload.uploadIntentId,
        },
      ],
    });

    const filed = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "add_client_file",
        input: {
          orgId: fixture.orgId,
          attachmentFileId: fileId,
          name: "123 Main Street Roof Report",
        },
        idempotencyKey: "file-roof-report-once",
      },
    );
    if (filed.outcome.status !== "succeeded") {
      throw new Error(JSON.stringify(filed.outcome));
    }
    expect(filed.outcome.result).toMatchObject({ status: "filed" });

    const rejected = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "add_client_file",
        input: {
          orgId: fixture.orgId,
          attachmentFileId: "F0BU8DYAEG6",
          name: "Slack file identifier",
        },
        idempotencyKey: "file-roof-report-slack-id",
      },
    );
    expect(rejected.outcome).toMatchObject({
      status: "failed",
      error: expect.stringContaining("exact storage ID"),
    });

    const byFilename = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "add_client_file",
        input: {
          orgId: fixture.orgId,
          attachmentFileId: "scan-004.pdf",
          name: "123 Main Street Roof Report",
        },
        idempotencyKey: "file-roof-report-by-filename",
      },
    );
    expect(byFilename.outcome).toMatchObject({
      status: "succeeded",
      result: { status: "already_filed" },
    });

    const confirmations = await fixture.t.run((ctx) =>
      ctx.db
        .query("operatorAgentConfirmations")
        .filter((query) => query.eq(query.field("threadId"), threadId))
        .collect(),
    );
    expect(confirmations).toEqual([]);

    const clientFiles = await fixture.t.run((ctx) =>
      ctx.db
        .query("clientFiles")
        .withIndex("organization", (index) => index.eq("orgId", fixture.orgId))
        .collect(),
    );
    expect(clientFiles).toHaveLength(1);
    expect(clientFiles[0]).toMatchObject({
      fileId,
      name: "123 Main Street Roof Report.pdf",
      originalName: "scan-004.pdf",
      clientVisible: false,
      nameSource: "agent",
      nameStatus: "ready",
    });
  });

  test("rejects invalid references for every exact-confirmed resource tool before asking for approval", async () => {
    const fixture = await seedOperatorAgentFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.firstOperatorUserId}|session`,
    });
    const threadId = await operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const invalidOrganizationReference = String(fixture.policyId);
    const invalidResourceReference = String(fixture.orgId);
    const cases = [
      {
        toolName: "confirm_policy_fact",
        input: {
          orgId: fixture.orgId,
          policyId: invalidResourceReference,
          fact: "The carrier is Northwoods Continental.",
          sourceSpanIds: ["span-1"],
        },
      },
      {
        toolName: "create_client_memory",
        input: {
          orgId: invalidOrganizationReference,
          content: "The company operates from a single headquarters.",
        },
      },
      {
        toolName: "update_client_memory",
        input: {
          memoryId: invalidResourceReference,
          content: "The company operates from a single headquarters.",
        },
      },
      {
        toolName: "delete_client_memory",
        input: { memoryId: invalidResourceReference },
      },
      {
        toolName: "create_procurement_memory",
        input: {
          orgId: invalidOrganizationReference,
          kind: "placement_preference",
          content: "The client prefers admitted markets.",
        },
      },
      {
        toolName: "update_procurement_memory",
        input: {
          procurementMemoryId: invalidResourceReference,
          content: "The client prefers admitted markets.",
        },
      },
      {
        toolName: "delete_procurement_memory",
        input: { procurementMemoryId: invalidResourceReference },
      },
      {
        toolName: "retry_failed_policy_extraction",
        input: { policyId: invalidResourceReference },
      },
      {
        toolName: "generate_coi",
        input: {
          policyId: invalidResourceReference,
          certificateHolder: "Carroll Avenue Holdings",
        },
      },
      {
        toolName: "update_client_file",
        input: {
          clientFileId: invalidResourceReference,
          name: "Appraisal.pdf",
        },
      },
      {
        toolName: "create_procurement_request",
        input: {
          orgId: fixture.orgId,
          title: "Carroll Avenue building purchase",
          requestSummary: "Arrange insurance for the acquisition.",
          requirements: "Property, liability, and earthquake coverage.",
          replacingPolicyId: invalidResourceReference,
        },
      },
      {
        toolName: "update_procurement_request",
        input: {
          procurementRequestId: invalidResourceReference,
          title: "Carroll Avenue building purchase",
        },
      },
      {
        toolName: "create_procurement_broker_outreach",
        input: {
          procurementRequestId: invalidResourceReference,
          brokerName: "Example Brokerage",
        },
      },
      {
        toolName: "update_procurement_broker_outreach",
        input: {
          procurementOutreachId: invalidResourceReference,
          brokerName: "Example Brokerage",
        },
      },
      {
        toolName: "create_procurement_file_item",
        input: {
          procurementRequestId: invalidResourceReference,
          purpose: "requirements",
          label: "Earthquake requirements",
        },
      },
      {
        toolName: "update_procurement_file_item",
        input: {
          procurementFileItemId: invalidResourceReference,
          label: "Earthquake requirements",
        },
      },
      {
        toolName: "update_procurement_email_thread",
        input: {
          procurementEmailThreadId: invalidResourceReference,
          category: "broker",
        },
      },
      {
        toolName: "update_organization_profile",
        input: {
          orgId: invalidOrganizationReference,
          name: "Carroll Holdings",
        },
      },
      {
        toolName: "set_organization_status",
        input: { orgId: invalidOrganizationReference, status: "live" },
      },
      {
        toolName: "set_client_feature_flag",
        input: {
          orgId: invalidOrganizationReference,
          flagId: "connect_features",
          enabled: true,
        },
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const result = await fixture.t.action(
        internal.operatorAgent.invokeRegisteredToolInternal,
        {
          operatorUserId: fixture.firstOperatorUserId,
          threadId,
          channel: "mcp",
          toolName: testCase.toolName,
          input: testCase.input,
          idempotencyKey: `invalid-preflight-${index}-${testCase.toolName}`,
        },
      );
      expect(result.outcome, testCase.toolName).toMatchObject({
        status: "failed",
      });
    }

    const confirmations = await fixture.t.run((ctx) =>
      ctx.db
        .query("operatorAgentConfirmations")
        .filter((query) => query.eq(query.field("threadId"), threadId))
        .collect(),
    );
    expect(confirmations).toEqual([]);
  });

  test("requests confirmation for every exact-confirmed resource tool with valid references", async () => {
    const fixture = await seedOperatorAgentFixture();
    const now = dayjs().valueOf();
    const seeded = await fixture.t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Example Brokerage",
        type: "broker",
      });
      const memoryId = await ctx.db.insert("orgMemory", {
        orgId: fixture.orgId,
        type: "fact",
        content:
          "Operator Agent Client operates from a single Portland headquarters.",
        source: "operator",
        createdAt: now,
        updatedAt: now,
      });
      const requestFields = {
        clientOrgId: fixture.orgId,
        requestSummary: "Arrange coverage for the new building purchase.",
        requirements: "Property, liability, and earthquake coverage.",
        status: "draft" as const,
        createdByUserId: fixture.firstOperatorUserId,
        updatedByUserId: fixture.firstOperatorUserId,
        createdAt: now,
        updatedAt: now,
      };
      const requestId = await ctx.db.insert("procurementRequests", {
        ...requestFields,
        title: "Carroll Avenue building purchase",
        inboxToken: "carroll-avenue-purchase",
      });
      const secondRequestId = await ctx.db.insert("procurementRequests", {
        ...requestFields,
        title: "Carroll Avenue earthquake placement",
        inboxToken: "carroll-avenue-earthquake",
      });
      const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
        requestId,
        clientOrgId: fixture.orgId,
        brokerOrgId,
        brokerName: "Example Brokerage",
        status: "request_sent",
        applicationQuestions: [],
        createdByUserId: fixture.firstOperatorUserId,
        updatedByUserId: fixture.firstOperatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      const procurementMemoryId = await ctx.db.insert("procurementMemory", {
        clientOrgId: fixture.orgId,
        kind: "placement_preference",
        content: "The client prefers admitted markets.",
        source: "operator_agent",
        requestId,
        outreachId,
        brokerOrgId,
        createdByUserId: fixture.firstOperatorUserId,
        updatedByUserId: fixture.firstOperatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      const fileItemId = await ctx.db.insert("procurementFileItems", {
        requestId,
        clientOrgId: fixture.orgId,
        purpose: "requirements",
        label: "Earthquake requirements",
        status: "requested",
        createdAt: now,
        updatedAt: now,
      });
      const emailThreadId = await ctx.db.insert("procurementEmailThreads", {
        clientOrgId: fixture.orgId,
        addressedRequestId: requestId,
        requestId,
        normalizedSubject: "earthquake quote",
        subject: "Earthquake quote",
        category: "other",
        categorySource: "auto",
        participantEmails: [],
        latestMessageAt: now,
        messageCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      const storedFileId = await ctx.storage.store(
        new Blob(["Building appraisal"], { type: "application/pdf" }),
      );
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId: fixture.orgId,
        fileId: storedFileId,
        name: "Appraisal.pdf",
        originalName: "appraisal.pdf",
        contentType: "application/pdf",
        size: 18,
        clientVisible: false,
        uploadedBySide: "operator",
        nameSource: "operator",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("sourceSpans", {
        orgId: fixture.orgId,
        policyId: fixture.policyId,
        spanId: "span-1",
        documentId: "policy-pdf",
        sourceKind: "policy_pdf",
        text: "Carrier: Northwoods Continental Insurance Company",
        textHash: "span-1-hash",
        createdAt: now,
      });
      const failedPolicyId = await ctx.db.insert("policies", {
        orgId: fixture.orgId,
        fileId: storedFileId,
        carrier: "Northwoods Continental Insurance Company",
        policyNumber: "NWC-PROP-3110-26-01",
        linesOfBusiness: ["Property"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Operator Agent Client",
        pipelineStatus: "error",
        extractionDataStage: "placeholder",
      });
      const requirementSourceDocumentId = await ctx.db.insert(
        "requirementSourceDocuments",
        {
          orgId: fixture.orgId,
          sourceType: "lease_agreement",
          title: "Carroll Avenue lease",
          status: "complete",
          createdByUserId: fixture.firstOperatorUserId,
          createdAt: now,
          updatedAt: now,
        },
      );
      const requirementId = await ctx.db.insert("insuranceRequirements", {
        orgId: fixture.orgId,
        kind: "coverage",
        scope: "own_org",
        title: "General liability",
        requirementText: "Maintain general liability coverage.",
        sourceDocumentId: requirementSourceDocumentId,
        status: "active",
        createdByUserId: fixture.firstOperatorUserId,
        updatedByUserId: fixture.firstOperatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      return {
        brokerOrgId,
        memoryId,
        requestId,
        secondRequestId,
        outreachId,
        procurementMemoryId,
        fileItemId,
        emailThreadId,
        clientFileId,
        failedPolicyId,
        requirementSourceDocumentId,
        requirementId,
      };
    });
    const cases = [
      {
        toolName: "confirm_policy_fact",
        input: {
          orgId: fixture.orgId,
          policyId: fixture.policyId,
          fact: "The carrier is Northwoods Continental Insurance Company.",
          sourceSpanIds: ["span-1"],
        },
      },
      {
        toolName: "create_client_memory",
        input: {
          orgId: fixture.orgId,
          content:
            "Operator Agent Client operates from a single Portland headquarters.",
        },
      },
      {
        toolName: "update_client_memory",
        input: {
          memoryId: seeded.memoryId,
          content: "Operator Agent Client operates from two Portland offices.",
        },
      },
      {
        toolName: "delete_client_memory",
        input: { memoryId: seeded.memoryId },
      },
      {
        toolName: "create_procurement_memory",
        input: {
          orgId: fixture.orgId,
          kind: "placement_preference",
          content: "The client prefers admitted markets.",
          procurementRequestId: seeded.requestId,
          procurementOutreachId: seeded.outreachId,
          brokerOrgId: seeded.brokerOrgId,
        },
      },
      {
        toolName: "update_procurement_memory",
        input: {
          procurementMemoryId: seeded.procurementMemoryId,
          content: "The client prefers admitted markets with A-rated carriers.",
        },
      },
      {
        toolName: "delete_procurement_memory",
        input: { procurementMemoryId: seeded.procurementMemoryId },
      },
      {
        toolName: "retry_failed_policy_extraction",
        input: { policyId: seeded.failedPolicyId },
      },
      {
        toolName: "generate_coi",
        input: {
          policyId: fixture.policyId,
          certificateHolder: "Carroll Avenue Holdings",
        },
      },
      {
        toolName: "generate_coi",
        input: {
          requirementSourceDocumentId: seeded.requirementSourceDocumentId,
          requirementId: seeded.requirementId,
        },
      },
      {
        toolName: "update_client_file",
        input: {
          clientFileId: seeded.clientFileId,
          name: "Building appraisal",
          policyId: fixture.policyId,
        },
      },
      {
        toolName: "create_procurement_request",
        input: {
          orgId: fixture.orgId,
          title: "Carroll Avenue building purchase",
          requestSummary: "Arrange coverage for the new building purchase.",
          requirements: "Property, liability, and earthquake coverage.",
          targetEffectiveDate: "2026-10-01",
          replacingPolicyId: fixture.policyId,
        },
      },
      {
        toolName: "update_procurement_request",
        input: {
          procurementRequestId: seeded.requestId,
          targetEffectiveDate: "2026-10-01",
          resultingPolicyId: fixture.policyId,
        },
      },
      {
        toolName: "create_procurement_broker_outreach",
        input: {
          procurementRequestId: seeded.requestId,
          brokerOrgId: seeded.brokerOrgId,
          brokerName: "Example Brokerage",
          contactEmail: "quotes@example.com",
          applicationUrl: "https://example.com/apply",
        },
      },
      {
        toolName: "update_procurement_broker_outreach",
        input: {
          procurementOutreachId: seeded.outreachId,
          brokerOrgId: seeded.brokerOrgId,
          status: "can_handle",
          quoteUrl: "https://example.com/quote",
        },
      },
      {
        toolName: "create_procurement_file_item",
        input: {
          procurementRequestId: seeded.requestId,
          procurementOutreachId: seeded.outreachId,
          clientFileId: seeded.clientFileId,
          purpose: "quote",
          label: "Quote",
        },
      },
      {
        toolName: "update_procurement_file_item",
        input: {
          procurementFileItemId: seeded.fileItemId,
          procurementOutreachId: seeded.outreachId,
          clientFileId: seeded.clientFileId,
          label: "Earthquake requirements",
        },
      },
      {
        toolName: "update_procurement_email_thread",
        input: {
          procurementEmailThreadId: seeded.emailThreadId,
          procurementRequestId: seeded.secondRequestId,
          category: "broker",
        },
      },
      {
        toolName: "update_organization_profile",
        input: { orgId: fixture.orgId, name: "Carroll Holdings" },
      },
      {
        toolName: "set_organization_status",
        input: { orgId: fixture.orgId, status: "live" },
      },
      {
        toolName: "set_client_feature_flag",
        input: {
          orgId: fixture.orgId,
          flagId: "connect_features",
          enabled: true,
        },
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const threadId = await fixture.t.mutation(
        internal.operatorAgent.createOrGetChannelThreadInternal,
        {
          operatorUserId: fixture.firstOperatorUserId,
          channel: "mcp",
          conversationKey: `mcp:valid-preflight-${index}`,
        },
      );
      const result = await fixture.t.action(
        internal.operatorAgent.invokeRegisteredToolInternal,
        {
          operatorUserId: fixture.firstOperatorUserId,
          threadId,
          channel: "mcp",
          toolName: testCase.toolName,
          input: testCase.input,
          idempotencyKey: `valid-preflight-${index}-${testCase.toolName}`,
        },
      );
      expect(result.outcome, testCase.toolName).toMatchObject({
        status: "confirmation_required",
      });
    }
  });

  test("replays a completed exact-confirmed action idempotently after its target is gone", async () => {
    const fixture = await seedOperatorAgentFixture();
    const now = dayjs().valueOf();
    const memoryId = await fixture.t.run((ctx) =>
      ctx.db.insert("orgMemory", {
        orgId: fixture.orgId,
        type: "fact",
        content:
          "Operator Agent Client operates from a single Portland headquarters.",
        source: "operator",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const threadId = await fixture.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        channel: "mcp",
        conversationKey: "mcp:delete-memory-replay",
      },
    );
    const invokeDelete = () =>
      fixture.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        channel: "mcp",
        toolName: "delete_client_memory",
        input: { memoryId },
        idempotencyKey: "delete-company-memory-once",
      });

    const requested = await invokeDelete();
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    ) {
      throw new Error("Expected exact memory confirmation");
    }
    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId: requested.outcome.confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(memoryId)),
    ).resolves.toBeNull();

    const replay = await invokeDelete();
    expect(replay.outcome).toMatchObject({
      status: "succeeded",
      idempotent: true,
    });
  });
});
