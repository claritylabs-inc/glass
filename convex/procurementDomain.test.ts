/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client",
      email: "client@example.com",
      accountKind: "customer",
    });
    const brokerUserId = await ctx.db.insert("users", {
      name: "Broker",
      email: "broker@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "member",
    });
    return {
      operatorUserId,
      clientUserId,
      brokerUserId,
      clientOrgId,
      brokerOrgId,
    };
  });
  return {
    t,
    ...ids,
    operator: t.withIdentity({ subject: `${ids.operatorUserId}|session` }),
    client: t.withIdentity({ subject: `${ids.clientUserId}|session` }),
    broker: t.withIdentity({ subject: `${ids.brokerUserId}|session` }),
  };
}

async function seedProposalFile(
  f: Awaited<ReturnType<typeof fixture>>,
  name = "quote.pdf",
) {
  return await f.t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const bytes = new TextEncoder().encode(`proposal:${name}`);
    const fileId = await ctx.storage.store(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: f.clientOrgId,
      fileId,
      name,
      originalName: name,
      contentType: "application/pdf",
      size: bytes.byteLength,
      clientVisible: false,
      uploadedByUserId: f.operatorUserId,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });
    return clientFileId;
  });
}

async function registerProposalUpload(
  f: Awaited<ReturnType<typeof fixture>>,
  requestId: Id<"procurementRequests">,
  fileId: Id<"_storage">,
) {
  const target = await f.operator.mutation(
    api.procurementProposals.generateUploadUrl,
    { requestId },
  );
  await f.operator.mutation(api.procurementProposals.registerUpload, {
    requestId,
    uploadIntentId: target.uploadIntentId,
    fileId,
  });
  return target.uploadIntentId;
}

describe("procurement domain boundaries", () => {
  test("stores client request uploads as canonical artifacts without activity rows", async () => {
    const f = await fixture();
    const request = await f.client.mutation(
      api.clientProcurementRequests.create,
      { title: "Client upload", narrative: "Review the attached schedule" },
    );
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["schedule"], { type: "application/pdf" })),
    );
    const attached = await f.client.mutation(
      api.clientProcurementRequests.attachFile,
      {
        requestId: request.requestId,
        storageId,
        fileName: "Schedule.pdf",
        contentType: "application/pdf",
        size: 8,
      },
    );
    const details = await f.client.query(api.clientProcurementRequests.get, {
      requestId: request.requestId,
    });
    expect(details.files).toEqual([
      expect.objectContaining({
        _id: attached.fileItemId,
        clientFileId: attached.clientFileId,
        name: "Schedule.pdf",
        uploadedBySide: "client",
      }),
    ]);
    expect(details).not.toHaveProperty("activity");
    const legacy = await f.t.run(async (ctx) => ({
      activities: await ctx.db.query("procurementRequestActivities").collect(),
      documents: await ctx.db.query("procurementRequestDocuments").collect(),
      clientFile: await ctx.db.get(attached.clientFileId),
      fileItem: await ctx.db.get(attached.fileItemId),
    }));
    expect(legacy.activities).toEqual([]);
    expect(legacy.documents).toEqual([]);
    expect(legacy.clientFile).toMatchObject({
      fileId: storageId,
      clientVisible: true,
      uploadedBySide: "client",
    });
    expect(legacy.fileItem).toMatchObject({
      clientFileId: attached.clientFileId,
      clientVisible: true,
    });
  });

  test("files one active proposal per outreach and converges on replay", async () => {
    const f = await fixture();
    const secondBrokerOrgId = await f.t.run((ctx) =>
      ctx.db.insert("organizations", { name: "Second Broker", type: "broker" }),
    );
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Two-market placement",
      narrative: "Compare two property quotes",
    });
    const [firstOutreach, secondOutreach] = await Promise.all([
      f.operator.mutation(api.procurementRequests.createOutreach, {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
      }),
      f.operator.mutation(api.procurementRequests.createOutreach, {
        requestId: request.requestId,
        brokerOrgId: secondBrokerOrgId,
      }),
    ]);
    const [firstFileId, secondFileId] = await Promise.all([
      seedProposalFile(f, "first-quote.pdf"),
      seedProposalFile(f, "second-quote.pdf"),
    ]);
    const first = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: firstOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: firstFileId }],
    });
    const replay = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: firstOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: firstFileId }],
    });
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: secondOutreach.outreachId,
        supersedesProposalId: first.proposalId,
        sources: [{ kind: "client_file", clientFileId: secondFileId }],
      }),
    ).rejects.toThrow("Superseded proposal must belong to this outreach");
    const second = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: secondOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: secondFileId }],
    });

    expect(replay).toMatchObject({
      proposalId: first.proposalId,
      status: "already_filed",
      extraction: { jobId: first.extraction.jobId, reused: true },
    });
    expect(second.proposalId).not.toBe(first.proposalId);
    const state = await f.t.run(async (ctx) => ({
      proposals: await ctx.db
        .query("procurementProposals")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect(),
      documents: await ctx.db.query("procurementProposalDocuments").collect(),
      jobs: await ctx.db.query("procurementProposalExtractionJobs").collect(),
      fileItems: await ctx.db
        .query("procurementFileItems")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect(),
    }));
    expect(state.proposals).toHaveLength(2);
    expect(state.documents).toHaveLength(2);
    expect(state.jobs).toHaveLength(2);
    expect(state.fileItems).toHaveLength(2);
    expect(state.documents.map((document) => document.clientFileId)).toEqual(
      expect.arrayContaining([firstFileId, secondFileId]),
    );
  });

  test("deduplicates replayed proposal uploads by content hash", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Hash replay",
      narrative: "File one quote once",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const { firstStorageId, replayStorageId } = await f.t.run(async (ctx) => ({
      firstStorageId: await ctx.storage.store(
        new Blob(["identical quote"], { type: "application/pdf" }),
      ),
      replayStorageId: await ctx.storage.store(
        new Blob(["identical quote"], { type: "application/pdf" }),
      ),
    }));
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        sources: [
          {
            kind: "upload",
            fileId: firstStorageId,
            fileName: "quote.pdf",
            contentType: "application/pdf",
          },
        ],
      }),
    ).rejects.toThrow("Browser proposal uploads require an upload intent");
    const [firstUploadIntentId, replayUploadIntentId] = await Promise.all([
      registerProposalUpload(f, request.requestId, firstStorageId),
      registerProposalUpload(f, request.requestId, replayStorageId),
    ]);
    const first = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [
        {
          kind: "upload",
          fileId: firstStorageId,
          fileName: "quote.pdf",
          contentType: "application/pdf",
          uploadIntentId: firstUploadIntentId,
        },
      ],
    });
    const replay = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [
        {
          kind: "upload",
          fileId: replayStorageId,
          fileName: "quote-copy.pdf",
          contentType: "application/pdf",
          uploadIntentId: replayUploadIntentId,
        },
      ],
    });
    expect(replay).toMatchObject({
      proposalId: first.proposalId,
      status: "already_filed",
    });
    const state = await f.t.run(async (ctx) => ({
      files: await ctx.db
        .query("clientFiles")
        .withIndex("organization", (query) => query.eq("orgId", f.clientOrgId))
        .collect(),
      replayBlob: await ctx.storage.get(replayStorageId),
      documents: await ctx.db.query("procurementProposalDocuments").collect(),
      uploadIntents: await ctx.db.query("clientFileUploadIntents").collect(),
    }));
    expect(state.files).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.uploadIntents).toEqual([]);
    expect(state.replayBlob).toBeNull();
  });

  test("reports expired proposal leases through the shared extraction tool", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Lease diagnostics",
      narrative: "Inspect proposal extraction",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "stuck-quote.pdf");
    const filed = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    await f.t.run((ctx) =>
      ctx.db.patch(filed.extraction.jobId, {
        status: "running",
        leaseId: "expired-lease",
        leaseExpiresAt: dayjs().subtract(1, "minute").valueOf(),
        attempts: 1,
      }),
    );
    const threadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const diagnostics = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "list_extraction_issues",
        input: { domain: "proposal", status: "stuck" },
        idempotencyKey: "list-stuck-proposal-extractions",
      },
    );
    expect(diagnostics.outcome).toMatchObject({
      status: "succeeded",
      result: {
        checkedDomains: ["proposal"],
        issues: [
          expect.objectContaining({
            domain: "proposal",
            proposalId: filed.proposalId,
            status: "stuck",
            recovery: "retry_procurement_proposal_extraction",
          }),
        ],
      },
    });
  });

  test("drops retried, cancelled, and archived proposals from extraction diagnostics", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Stale diagnostics",
      narrative: "Only live proposals are extraction issues",
    });
    const [retried, cancelled, archived] = await Promise.all(
      ["Retried", "Cancelled", "Archived"].map(async (label) => {
        const brokerOrgId = await f.t.run((ctx) =>
          ctx.db.insert("organizations", {
            name: `${label} broker`,
            type: "broker" as const,
          }),
        );
        const outreach = await f.operator.mutation(
          api.procurementRequests.createOutreach,
          { requestId: request.requestId, brokerOrgId },
        );
        const clientFileId = await seedProposalFile(
          f,
          `${label.toLowerCase()}-quote.pdf`,
        );
        return await f.operator.mutation(api.procurementProposals.file, {
          requestId: request.requestId,
          outreachId: outreach.outreachId,
          sources: [{ kind: "client_file", clientFileId }],
        });
      }),
    );

    // The retried and archived proposals start from a failed extraction job;
    // the cancelled one keeps the live job an operator can still stop.
    await f.t.run(async (ctx) => {
      for (const filed of [retried, archived])
        await ctx.db.patch(filed.extraction.jobId, {
          status: "failed",
          lastError: "Worker crashed",
          attempts: 1,
        });
      await ctx.db.patch(retried.proposalId, { status: "draft" });
    });

    const threadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const diagnose = async (idempotencyKey: string) =>
      await f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp" as const,
        toolName: "list_extraction_issues",
        input: { domain: "proposal", status: "error" },
        idempotencyKey,
      });

    const before = await diagnose("list-failed-proposal-extractions");
    expect(before.outcome.status).toBe("succeeded");
    expect(
      (
        before.outcome as { result: { issues: Array<{ proposalId: string }> } }
      ).result.issues
        .map((issue) => String(issue.proposalId))
        .sort(),
    ).toEqual([retried.proposalId, archived.proposalId].map(String).sort());

    const requeued = await f.operator.mutation(
      api.procurementProposals.retryExtraction,
      { proposalId: retried.proposalId },
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(requeued.jobId, { status: "complete" });
      await ctx.db.patch(retried.proposalId, { status: "review_ready" });
    });
    await f.operator.mutation(api.procurementProposals.cancelExtraction, {
      proposalId: cancelled.proposalId,
    });
    await f.operator.mutation(api.procurementProposals.archive, {
      proposalId: archived.proposalId,
    });

    const after = await diagnose("list-failed-proposal-extractions-after");
    expect(after.outcome).toMatchObject({
      status: "succeeded",
      result: { issues: [] },
    });
  });

  test("lets clients collaborate through an allowlisted request DTO without exposing private proposals", async () => {
    const f = await fixture();
    const created = await f.client.mutation(
      api.clientProcurementRequests.create,
      { title: "Property renewal", narrative: "We need property coverage" },
    );
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: created.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f);
    await f.operator.mutation(api.procurementProposals.file, {
      requestId: created.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    const dto = await f.client.query(api.clientProcurementRequests.get, {
      requestId: created.requestId,
    });
    expect(dto).toMatchObject({
      title: "Property renewal",
      status: "submitted",
      narrative: "We need property coverage",
    });
    expect(dto).not.toHaveProperty("proposals");
    expect(dto).not.toHaveProperty("outreaches");
    expect(dto).not.toHaveProperty("emailThreads");
    expect(dto.packet).not.toHaveProperty("sections");
    await expect(
      f.client.query(api.procurementProposals.list, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(
      f.broker.query(api.clientProcurementRequests.get, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("Client membership required");
  });

  test("keeps an operator-created request private until it is shared", async () => {
    const f = await fixture();
    const created = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Private placement",
      narrative: "Prepare options before involving the client",
    });

    await expect(
      f.client.query(api.clientProcurementRequests.get, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("Request not found");
    await expect(
      f.client.query(api.clientProcurementRequests.list, {}),
    ).resolves.toEqual([]);
  });

  test("requires proposal outreach consistency and invalidates a confirmed review when the broker-visible packet changes", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Placement",
      narrative: "Place coverage",
      clientVisible: true,
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const otherRequest = await f.operator.mutation(
      api.procurementRequests.create,
      {
        clientOrgId: f.clientOrgId,
        title: "Other placement",
        narrative: "Place other coverage",
      },
    );
    const otherOutreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: otherRequest.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "placement-quote.pdf");
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: otherOutreach.outreachId,
        sources: [{ kind: "client_file", clientFileId }],
      }),
    ).rejects.toThrow("Outreach does not belong to this request");
    const proposal = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    // The broker answered this packet section, so the review binds to it.
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "coverage_requested",
      body: "General liability, $1m each occurrence.",
    });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(proposal.proposalId, {
        status: "review_ready",
        extractionFingerprint: "fp-1",
        extractedOffer: { premiumAmount: 1000 },
      });
    });
    const packetRevision = await f.t.run(async (ctx) => {
      const row = await ctx.db.get(request.requestId);
      return row?.packetRevision ?? 0;
    });
    const review = await f.t.mutation(
      internal.procurementProposals.saveGeneratedReviewInternal,
      {
        operatorUserId: f.operatorUserId,
        proposalId: proposal.proposalId,
        extractionFingerprint: "fp-1",
        packetRevision,
        findings: [],
        conclusion: "has_gaps",
      },
    );
    await f.operator.mutation(api.procurementProposals.confirmReview, {
      reviewId: review.reviewId,
      conclusion: "has_gaps",
    });
    // Editing the packet the broker was sent must invalidate the review.
    await f.operator.mutation(api.procurementPacket.upsertSection, {
      requestId: request.requestId,
      key: "coverage_requested",
      body: "General liability, $2m each occurrence.",
    });
    await expect(
      f.operator.mutation(api.procurementProposals.select, {
        proposalId: proposal.proposalId,
      }),
    ).rejects.toThrow("current staff-confirmed review");
  });

  test("supports broker profiles without users and keeps member edits read-only", async () => {
    const f = await fixture();
    const standalone = await f.operator.mutation(
      api.brokerProfiles.createStandalone,
      {
        name: "No Portal Broker",
        networkStatus: "prospect",
        writingStates: ["ca"],
        lineOfBusinessCodes: ["cgl"],
      },
    );
    const rows = await f.operator.query(api.brokerProfiles.list, {
      writingState: "CA",
      lineOfBusinessCode: "CGL",
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          broker: expect.objectContaining({ _id: standalone.brokerOrgId }),
          contacts: [],
        }),
      ]),
    );
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Network profile privacy",
      narrative: "Place coverage",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "network-quote.pdf");
    await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    const brokerProfile = await f.broker.query(api.brokerProfiles.get, {
      brokerOrgId: f.brokerOrgId,
    });
    expect(brokerProfile).not.toHaveProperty("proposalCount");
    expect(brokerProfile).not.toHaveProperty("lastOutreachAt");
    await expect(
      f.broker.mutation(api.brokerProfiles.upsert, {
        brokerOrgId: f.brokerOrgId,
        networkStatus: "active",
        writingStates: ["CA"],
        lineOfBusinessCodes: ["CGL"],
      }),
    ).rejects.toThrow("Broker admin required");
  });
});
