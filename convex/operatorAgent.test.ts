/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
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
      dedupeKey: "shared-slack-message",
    });
    await expect(
      secondOperator.query(api.operatorAgent.getThread, {
        threadId: firstSharedThread,
      }),
    ).resolves.toMatchObject({
      thread: { visibility: "shared", channel: "slack" },
    });
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
    const threadId = await operator.mutation(
      api.operatorAgent.createThread,
      { initialContext: policyContext },
    );

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

  test("files an exact thread attachment for a client only after confirmation", async () => {
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
    const threadId = await operator.mutation(api.operatorAgent.createThread, {});
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
          clientVisible: false,
        },
        idempotencyKey: "file-roof-report-once",
      },
    );
    expect(filed.outcome.status).toBe("confirmation_required");
    if (
      filed.outcome.status !== "confirmation_required" ||
      !filed.outcome.confirmationId
    ) {
      throw new Error("Expected exact operator confirmation");
    }

    const confirmation = await fixture.t.mutation(
      internal.operatorAgent.confirmActionInternal,
      {
        operatorUserId: fixture.firstOperatorUserId,
        threadId,
        confirmationId: filed.outcome.confirmationId,
        decision: "approve",
        channel: "mcp",
      },
    );
    if (confirmation.status === "failed") {
      throw new Error(JSON.stringify(confirmation));
    }
    expect(confirmation).toMatchObject({ status: "completed" });

    const clientFiles = await fixture.t.run((ctx) =>
      ctx.db
        .query("clientFiles")
        .withIndex("organization", (index) =>
          index.eq("orgId", fixture.orgId),
        )
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
});
