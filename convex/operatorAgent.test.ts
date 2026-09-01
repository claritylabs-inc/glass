/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
    return { firstOperatorUserId, secondOperatorUserId, orgId };
  });
  return { t, ...ids };
}

describe("operator agent boundary", () => {
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

    await firstOperator.mutation(api.operatorAgent.sendMessage, {
      threadId,
      content: "Summarize the attached renewal data.",
      attachments: [
        {
          fileId,
          filename: "renewals.csv",
          contentType: "",
          size: 1,
        },
      ],
    });

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
});
