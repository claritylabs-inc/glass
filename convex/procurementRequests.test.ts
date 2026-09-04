/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedProcurementFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client Admin",
      email: "client@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const otherClientOrgId = await ctx.db.insert("organizations", {
      name: "Other Client",
      type: "client",
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker One",
      type: "broker",
    });
    await Promise.all([
      ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@spot.insure",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "admin",
      }),
    ]);
    const archivedPolicyId = await ctx.db.insert("policies", {
      orgId: clientOrgId,
      carrier: "Travelers",
      policyNumber: "OLD-100",
      linesOfBusiness: ["Property"],
      documentType: "policy",
      policyYear: 2025,
      effectiveDate: "01/01/2025",
      expirationDate: "01/01/2026",
      isRenewal: false,
      coverages: [],
      insuredName: "Cove",
      extractionDataStage: "final",
      deletedAt: now,
    });
    const otherPolicyId = await ctx.db.insert("policies", {
      orgId: otherClientOrgId,
      carrier: "Hartford",
      policyNumber: "OTHER-1",
      linesOfBusiness: ["Property"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Other Client",
      extractionDataStage: "final",
    });
    return {
      operatorUserId,
      clientUserId,
      clientOrgId,
      otherClientOrgId,
      brokerOrgId,
      archivedPolicyId,
      otherPolicyId,
    };
  });
  return { t, ...ids };
}

async function createRequest(
  fixture: Awaited<ReturnType<typeof seedProcurementFixture>>,
  title: string,
) {
  const operator = fixture.t.withIdentity({
    subject: `${fixture.operatorUserId}|session`,
  });
  return await operator.mutation(api.procurementRequests.create, {
    clientOrgId: fixture.clientOrgId,
    title,
    narrative: `Client asked for ${title}`,
    replacingPolicyId: fixture.archivedPolicyId,
  });
}

describe("procurement requests", () => {
  test("creates a unique per-request forwarding address and permits archived replacement policies", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const client = fixture.t.withIdentity({
      subject: `${fixture.clientUserId}|session`,
    });

    await expect(
      client.mutation(api.procurementRequests.create, {
        clientOrgId: fixture.clientOrgId,
        title: "Client write",
        narrative: "Not allowed",
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");

    const first = await createRequest(fixture, "First request");
    const second = await createRequest(fixture, "Second request");
    expect(first.forwardingAddress).toMatch(/^procurement\+[a-f0-9]{32}@/);
    expect(second.forwardingAddress).not.toBe(first.forwardingAddress);

    await expect(
      operator.mutation(api.procurementRequests.create, {
        clientOrgId: fixture.clientOrgId,
        title: "Cross-client replacement",
        narrative: "Should fail",
        replacingPolicyId: fixture.otherPolicyId,
      }),
    ).rejects.toThrow("Policy does not belong to this client");

    const listed = await operator.query(api.procurementRequests.list, {
      clientOrgId: fixture.clientOrgId,
    });
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: first.requestId,
          replacingPolicy: expect.objectContaining({ archived: true }),
        }),
      ]),
    );
  });

  test("blocks direct writes during operator impersonation", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    await fixture.t.run((ctx) =>
      ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId: fixture.operatorUserId,
        targetOrgId: fixture.clientOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: dayjs().valueOf(),
      }),
    );

    await expect(
      operator.mutation(api.procurementRequests.create, {
        clientOrgId: fixture.clientOrgId,
        title: "Blocked",
        narrative: "Blocked",
      }),
    ).rejects.toThrow("IMPERSONATION_READ_ONLY");
  });

  test("tracks broker application, quote, and requested-file state with client isolation", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const request = await createRequest(fixture, "Broker workflow");
    const outreach = await operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: fixture.brokerOrgId,
        contactEmail: "broker@example.com",
        status: "can_handle",
        applicationUrl: "https://broker.example/application",
        applicationQuestions: ["Provide updated roof reports"],
      },
    );
    await operator.mutation(api.procurementRequests.updateOutreach, {
      outreachId: outreach.outreachId,
      status: "quote_accepted",
      quoteAmount: 12_500,
      quoteCurrency: "usd",
      quoteSummary: "Accepted property package",
    });
    const fileItem = await operator.mutation(
      api.procurementRequests.createFileItem,
      {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        purpose: "requested_document",
        label: "Updated roof report",
      },
    );
    expect(fileItem.fileItemId).toBeTruthy();

    const otherFileId = await fixture.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["other"]));
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.otherClientOrgId,
        fileId,
        name: "other.pdf",
        originalName: "other.pdf",
        contentType: "application/pdf",
        size: 5,
        clientVisible: false,
        uploadedBySide: "operator",
        uploadedByUserId: fixture.operatorUserId,
        nameSource: "operator",
        nameStatus: "ready",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      operator.mutation(api.procurementRequests.updateFileItem, {
        fileItemId: fileItem.fileItemId,
        clientFileId: otherFileId,
      }),
    ).rejects.toThrow("Client file does not belong");

    const linkedFileId = await fixture.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["report"]));
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.clientOrgId,
        fileId,
        name: "Roof condition report.pdf",
        originalName: "roof-report.pdf",
        contentType: "application/pdf",
        size: 6,
        clientVisible: false,
        uploadedBySide: "operator",
        uploadedByUserId: fixture.operatorUserId,
        nameSource: "operator",
        nameStatus: "ready",
        createdAt: 2,
        updatedAt: 2,
      });
    });
    const unscopedClaim = await fixture.t.mutation(
      internal.companyInformation.claimClientFileInternal,
      { clientFileId: linkedFileId },
    );
    expect(unscopedClaim.status).toBe("claimed");
    if (unscopedClaim.status !== "claimed") {
      throw new Error("Expected unscoped file claim");
    }
    expect(unscopedClaim.source.requestId).toBeUndefined();

    await operator.mutation(api.procurementRequests.updateFileItem, {
      fileItemId: fileItem.fileItemId,
      clientFileId: linkedFileId,
      status: "available",
    });
    const scopedClaim = await fixture.t.mutation(
      internal.companyInformation.claimClientFileInternal,
      { clientFileId: linkedFileId },
    );
    expect(scopedClaim.status).toBe("claimed");
    if (scopedClaim.status !== "claimed") {
      throw new Error("Expected request-scoped file claim");
    }
    expect(scopedClaim.source.requestId).toBe(request.requestId);
    expect(scopedClaim.source.sourceFingerprint).not.toBe(
      unscopedClaim.source.sourceFingerprint,
    );

    const details = await operator.query(api.procurementRequests.get, {
      requestId: request.requestId,
    });
    expect(details.outreaches[0]).toMatchObject({
      status: "quote_accepted",
      quoteAmount: 12_500,
      quoteCurrency: "USD",
      applicationQuestions: ["Provide updated roof reports"],
    });
    expect(details.files[0]).toMatchObject({
      status: "available",
      clientFile: {
        originalName: "roof-report.pdf",
        uploadedBySide: "operator",
      },
    });
  });

  test("keeps header-correlated replies with a manually moved thread and preserves its category", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const first = await createRequest(fixture, "Addressed request");
    const second = await createRequest(fixture, "Assigned request");
    await operator.mutation(api.procurementRequests.createOutreach, {
      requestId: first.requestId,
      brokerOrgId: fixture.brokerOrgId,
      contactEmail: "broker@example.com",
    });

    const initial = await fixture.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: first.requestId,
        resendEmailId: "resend-1",
        messageId: "<message-1@example.com>",
        references: [],
        subject: "Property quote",
        fromEmail: "operator@spot.insure",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Forwarded for review",
        participantEmails: ["broker@example.com"],
        attachments: [],
        receivedAt: 1,
      },
    );
    const initialThreadId = initial.threadId as Id<"procurementEmailThreads">;
    await operator.mutation(api.procurementRequests.updateEmailThread, {
      emailThreadId: initialThreadId,
      category: "other",
      requestId: second.requestId,
    });

    const reply = await fixture.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: first.requestId,
        resendEmailId: "resend-2",
        messageId: "<message-2@example.com>",
        inReplyTo: "<message-1@example.com>",
        references: ["<message-1@example.com>"],
        subject: "Re: Property quote",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Here is our response",
        participantEmails: ["broker@example.com"],
        attachments: [],
        receivedAt: 2,
      },
    );

    expect(reply.threadId).toBe(initialThreadId);
    const storedThread = await fixture.t.run((ctx) =>
      ctx.db.get(initialThreadId),
    );
    expect(storedThread).toMatchObject({
      addressedRequestId: first.requestId,
      requestId: second.requestId,
      category: "other",
      categorySource: "operator",
      messageCount: 2,
    });
  });

  test("reuses one canonical client file for identical forwarded attachments", async () => {
    const fixture = await seedProcurementFixture();
    const request = await createRequest(fixture, "Forwarded quote");
    const { firstStorageId, replayStorageId } = await fixture.t.run(
      async (ctx) => ({
        firstStorageId: await ctx.storage.store(
          new Blob(["same forwarded quote"], { type: "application/pdf" }),
        ),
        replayStorageId: await ctx.storage.store(
          new Blob(["same forwarded quote"], { type: "application/pdf" }),
        ),
      }),
    );
    const ingest = (input: {
      resendEmailId: string;
      messageId: string;
      fileId: Id<"_storage">;
      receivedAt: number;
    }) =>
      fixture.t.mutation(internal.procurementRequests.ingestEmailInternal, {
        addressedRequestId: request.requestId,
        resendEmailId: input.resendEmailId,
        messageId: input.messageId,
        references: [],
        subject: "Property quote",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Attached quote",
        participantEmails: ["broker@example.com"],
        attachments: [
          {
            fileId: input.fileId,
            filename: "quote.pdf",
            contentType: "application/pdf",
            size: 20,
          },
        ],
        receivedAt: input.receivedAt,
      });

    const first = await ingest({
      resendEmailId: "forwarded-quote-1",
      messageId: "<forwarded-quote-1@example.com>",
      fileId: firstStorageId,
      receivedAt: 1,
    });
    const replay = await ingest({
      resendEmailId: "forwarded-quote-2",
      messageId: "<forwarded-quote-2@example.com>",
      fileId: replayStorageId,
      receivedAt: 2,
    });

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(false);
    if (first.duplicate || replay.duplicate) {
      throw new Error("Expected distinct messages to be ingested");
    }
    expect(replay.clientFileIds).toEqual(first.clientFileIds);
    const state = await fixture.t.run(async (ctx) => ({
      clientFiles: await ctx.db
        .query("clientFiles")
        .withIndex("organization", (query) =>
          query.eq("orgId", fixture.clientOrgId),
        )
        .collect(),
      messages: await ctx.db.query("procurementEmailMessages").collect(),
      fileItems: await ctx.db.query("procurementFileItems").collect(),
      replayBlob: await ctx.storage.get(replayStorageId),
    }));
    expect(state.clientFiles).toHaveLength(1);
    expect(state.messages).toHaveLength(2);
    expect(state.fileItems).toHaveLength(2);
    expect(state.fileItems.map((item) => item.clientFileId)).toEqual([
      first.clientFileIds[0],
      first.clientFileIds[0],
    ]);
    expect(state.replayBlob).toBeNull();
  });

  test("files a chosen attachment subset and stops offering archived threads", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const request = await createRequest(fixture, "Subset quote filing");
    const outreach = await operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: fixture.brokerOrgId,
        contactEmail: "broker@example.com",
      },
    );
    const attachments = await Promise.all(
      [
        { filename: "broker-quote.pdf", contentType: "application/pdf" },
        { filename: "signature.png", contentType: "image/png" },
      ].map(async (attachment) => {
        const bytes = new TextEncoder().encode(attachment.filename);
        const fileId = await fixture.t.run((ctx) =>
          ctx.storage.store(
            new Blob([bytes], { type: attachment.contentType }),
          ),
        );
        return { ...attachment, fileId, size: bytes.byteLength };
      }),
    );
    const imported = await fixture.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: request.requestId,
        resendEmailId: "subset-quote-1",
        messageId: "<subset-quote-1@example.com>",
        references: [],
        subject: "Quote and signature",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Quote attached",
        participantEmails: ["broker@example.com"],
        attachments,
        receivedAt: 1,
      },
    );
    if (imported.duplicate) throw new Error("Expected email import");
    const emailThreadId = imported.threadId as Id<"procurementEmailThreads">;
    const [quoteFileId, signatureFileId] = imported.clientFileIds;

    const preview = await operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(preview.filable).toBe(true);
    expect(preview.unfiledFiles).toHaveLength(2);
    expect(preview.outreaches).toMatchObject([
      { outreachId: outreach.outreachId },
    ]);

    const unrelatedClientFileId = await fixture.t.run(async (ctx) => {
      const bytes = new TextEncoder().encode("unrelated");
      const fileId = await ctx.storage.store(
        new Blob([bytes], { type: "application/pdf" }),
      );
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.clientOrgId,
        fileId,
        name: "unrelated.pdf",
        originalName: "unrelated.pdf",
        contentType: "application/pdf",
        size: bytes.byteLength,
        clientVisible: false,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator" as const,
        nameSource: "original" as const,
        nameStatus: "ready" as const,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      operator.mutation(api.procurementProposals.fileEmailQuote, {
        emailThreadId,
        outreachId: outreach.outreachId,
        clientFileIds: [unrelatedClientFileId],
      }),
    ).rejects.toThrow(/not an active file on this email thread/);

    const filed = await operator.mutation(
      api.procurementProposals.fileEmailQuote,
      {
        emailThreadId,
        outreachId: outreach.outreachId,
        clientFileIds: [quoteFileId],
      },
    );
    const documents = await fixture.t.run((ctx) =>
      ctx.db
        .query("procurementProposalDocuments")
        .withIndex("proposal", (index) =>
          index.eq("proposalId", filed.proposalId),
        )
        .collect(),
    );
    expect(documents).toMatchObject([{ fileName: "broker-quote.pdf" }]);

    const afterFiling = await operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(afterFiling.unfiledFiles).toMatchObject([
      { clientFileId: signatureFileId },
    ]);

    await operator.mutation(api.procurementRequests.setEmailThreadArchived, {
      emailThreadId,
      archived: true,
    });
    const archivedPreview = await operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(archivedPreview.filable).toBe(false);
    expect(archivedPreview.nextActions).toEqual([]);
    await expect(
      operator.mutation(api.procurementProposals.fileEmailQuote, {
        emailThreadId,
        outreachId: outreach.outreachId,
      }),
    ).rejects.toThrow(/not found/);
  });

  test("reconciles and atomically files forwarded quote attachments", async () => {
    const fixture = await seedProcurementFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const request = await createRequest(fixture, "Forwarded broker quote");
    const outreach = await operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: fixture.brokerOrgId,
        contactEmail: "broker@example.com",
      },
    );
    const otherOutreach = await operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: fixture.brokerOrgId,
        contactEmail: "other-broker@example.com",
      },
    );
    const bytes = new TextEncoder().encode("source-backed quote");
    const storageId = await fixture.t.run((ctx) =>
      ctx.storage.store(new Blob([bytes], { type: "application/pdf" })),
    );
    const imported = await fixture.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: request.requestId,
        resendEmailId: "reconcile-quote-1",
        messageId: "<reconcile-quote-1@example.com>",
        references: [],
        subject: "Quote attached",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Please review our quote",
        participantEmails: ["broker@example.com"],
        attachments: [
          {
            fileId: storageId,
            filename: "broker-quote.pdf",
            contentType: "application/pdf",
            size: bytes.byteLength,
          },
        ],
        receivedAt: 1,
      },
    );
    if (imported.duplicate) throw new Error("Expected email import");
    const emailThreadId = imported.threadId as Id<"procurementEmailThreads">;

    const threadId = await operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const agentPreview = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "preview_procurement_email_reconciliation",
        input: { procurementEmailThreadId: emailThreadId },
        idempotencyKey: "preview-forwarded-broker-quote",
      },
    );
    expect(agentPreview.outcome).toMatchObject({
      status: "succeeded",
      result: {
        requestId: request.requestId,
        unfiledFiles: [{ name: "broker-quote.pdf" }],
        outreachInference: {
          status: "exact",
          candidates: [{ outreachId: outreach.outreachId }],
        },
        nextActions: [
          {
            tool: "file_procurement_email_quote",
            input: { procurementOutreachId: outreach.outreachId },
          },
        ],
      },
    });

    const requested = await fixture.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: fixture.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "file_procurement_email_quote",
        input: {
          procurementEmailThreadId: emailThreadId,
          procurementOutreachId: outreach.outreachId,
        },
        idempotencyKey: "file-forwarded-broker-quote",
      },
    );
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    )
      throw new Error("Expected exact proposal-filing confirmation");
    await expect(
      fixture.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: fixture.operatorUserId,
        threadId,
        confirmationId: requested.outcome.confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    const state = await fixture.t.run(async (ctx) => {
      const proposals = await ctx.db
        .query("procurementProposals")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect();
      const documents = await ctx.db
        .query("procurementProposalDocuments")
        .collect();
      const jobs = await ctx.db
        .query("procurementProposalExtractionJobs")
        .collect();
      return { proposals, documents, jobs };
    });
    expect(state.proposals).toHaveLength(1);
    expect(state.documents).toMatchObject([
      {
        proposalId: state.proposals[0]._id,
        clientFileId: imported.clientFileIds[0],
        fileName: "broker-quote.pdf",
      },
    ]);
    expect(state.jobs).toHaveLength(1);

    const replay = await operator.mutation(
      api.procurementProposals.fileEmailQuote,
      { emailThreadId, outreachId: outreach.outreachId },
    );
    expect(replay).toMatchObject({
      proposalId: state.proposals[0]._id,
      status: "already_filed",
      extraction: { jobId: state.jobs[0]._id, reused: true },
    });

    const [after, otherOutreachPreview, details] = await Promise.all([
      operator.query(api.procurementRequests.previewEmailReconciliation, {
        emailThreadId,
      }),
      operator.query(api.procurementRequests.previewEmailReconciliation, {
        emailThreadId,
        outreachId: otherOutreach.outreachId,
      }),
      operator.query(api.procurementRequests.get, {
        requestId: request.requestId,
      }),
    ]);
    expect(after.unfiledFiles).toEqual([]);
    expect(after.nextActions).toEqual([]);
    expect(otherOutreachPreview.unfiledFiles).toMatchObject([
      { clientFileId: imported.clientFileIds[0], name: "broker-quote.pdf" },
    ]);
    expect(otherOutreachPreview.nextActions).toEqual([]);
    expect(details.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Filed proposal from Broker One for Forwarded broker quote",
        }),
      ]),
    );
  });
});
