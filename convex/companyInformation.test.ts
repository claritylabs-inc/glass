/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function profile(
  values: Partial<{
    operationsDescription: string;
    fein: string;
  }> = {},
) {
  const fact = (value: string | undefined) =>
    value
      ? { value, confidence: 0.98, evidence: `Explicitly states ${value}` }
      : null;
  return {
    namedInsured: null,
    mailingAddress: null,
    dba: null,
    entityType: null,
    fein: fact(values.fein),
    businessNumber: null,
    operationsDescription: fact(values.operationsDescription),
    additionalNamedInsureds: [],
  };
}

async function seedFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { operatorUserId, clientOrgId };
  });
  return { t, ...ids };
}

describe("company information extraction lifecycle", () => {
  test("removes structured and memory facts when an extracted client file is archived", async () => {
    const fixture = await seedFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const clientFileId = await fixture.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(["Cove operates a commercial vehicle fleet."], {
          type: "text/plain",
        }),
      );
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.clientOrgId,
        fileId,
        name: "Application.txt",
        originalName: "application.txt",
        contentType: "text/plain",
        size: 42,
        clientVisible: false,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "operator",
        nameStatus: "ready",
        createdAt: 100,
        updatedAt: 100,
      });
    });

    const claim = await fixture.t.mutation(
      internal.companyInformation.claimClientFileInternal,
      { clientFileId },
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected source claim");
    await fixture.t.mutation(
      internal.companyInformation.completeClientFileInternal,
      {
        clientFileId,
        sourceFingerprint: claim.source.sourceFingerprint,
        profile: profile({
          operationsDescription: "Commercial vehicle fleet operations",
          fein: "12-3456789",
        }),
        organizationFacts: [
          {
            content: "Cove operates a commercial vehicle fleet.",
            confidence: 0.98,
          },
        ],
        procurementFacts: [
          {
            kind: "placement_preference",
            content: "Cove prefers a $5,000 physical-damage deductible.",
            confidence: 0.95,
          },
        ],
      },
    );

    const populated = await fixture.t.run(async (ctx) => ({
      org: await ctx.db.get(fixture.clientOrgId),
      memory: await ctx.db.query("orgMemory").collect(),
      procurement: await ctx.db.query("procurementMemory").collect(),
    }));
    expect(populated.org?.profileFacts).toMatchObject({
      fein: { value: "12-3456789" },
      operationsDescription: {
        value: "Commercial vehicle fleet operations",
      },
    });
    expect(populated.memory).toEqual([
      expect.objectContaining({
        content: "Cove operates a commercial vehicle fleet.",
        sourceRefs: [`client-file:${clientFileId}`],
      }),
    ]);
    expect(populated.procurement).toEqual([
      expect.objectContaining({
        kind: "placement_preference",
        source: "document",
        sourceRefs: [`client-file:${clientFileId}`],
      }),
    ]);

    await operator.mutation(api.clientFiles.setArchived, {
      clientFileId,
      archived: true,
    });

    const cleaned = await fixture.t.run(async (ctx) => ({
      org: await ctx.db.get(fixture.clientOrgId),
      memory: await ctx.db.query("orgMemory").collect(),
      procurement: await ctx.db.query("procurementMemory").collect(),
      extractions: await ctx.db
        .query("companyInformationExtractions")
        .collect(),
    }));
    expect(cleaned.org?.profileFacts).toBeUndefined();
    expect(cleaned.memory).toEqual([]);
    expect(cleaned.procurement).toEqual([]);
    expect(cleaned.extractions).toEqual([]);
  });

  test("preserves facts that remain supported by another active file", async () => {
    const fixture = await seedFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const clientFileIds = await fixture.t.run(async (ctx) => {
      const ids = [];
      for (const suffix of ["application", "questionnaire"]) {
        const fileId = await ctx.storage.store(
          new Blob(["Cove operates a commercial vehicle fleet."], {
            type: "text/plain",
          }),
        );
        ids.push(
          await ctx.db.insert("clientFiles", {
            orgId: fixture.clientOrgId,
            fileId,
            name: `${suffix}.txt`,
            originalName: `${suffix}.txt`,
            contentType: "text/plain",
            size: 42,
            clientVisible: false,
            uploadedByUserId: fixture.operatorUserId,
            uploadedBySide: "operator",
            nameSource: "operator",
            nameStatus: "ready",
            createdAt: 100,
            updatedAt: 100,
          }),
        );
      }
      return ids;
    });

    for (const clientFileId of clientFileIds) {
      const claim = await fixture.t.mutation(
        internal.companyInformation.claimClientFileInternal,
        { clientFileId },
      );
      expect(claim.status).toBe("claimed");
      if (claim.status !== "claimed") throw new Error("Expected source claim");
      await fixture.t.mutation(
        internal.companyInformation.completeClientFileInternal,
        {
          clientFileId,
          sourceFingerprint: claim.source.sourceFingerprint,
          profile: profile({ fein: "12-3456789" }),
          organizationFacts: [
            {
              content: "Cove operates a commercial vehicle fleet.",
              confidence: 0.98,
            },
          ],
          procurementFacts: [
            {
              kind: "placement_preference",
              content: "Cove prefers a $5,000 physical-damage deductible.",
              confidence: 0.95,
            },
          ],
        },
      );
    }

    await operator.mutation(api.clientFiles.setArchived, {
      clientFileId: clientFileIds[0]!,
      archived: true,
    });

    const state = await fixture.t.run(async (ctx) => ({
      org: await ctx.db.get(fixture.clientOrgId),
      memory: await ctx.db.query("orgMemory").unique(),
      procurement: await ctx.db.query("procurementMemory").unique(),
    }));
    expect(state.org?.profileFacts?.fein).toMatchObject({
      value: "12-3456789",
      source: {
        sourceKind: "client_file",
        sourceRef: `client-file:${clientFileIds[1]}`,
      },
    });
    expect(state.memory?.sourceRefs).toEqual([
      `client-file:${clientFileIds[1]}`,
    ]);
    expect(state.procurement?.sourceRefs).toEqual([
      `client-file:${clientFileIds[1]}`,
    ]);
  });

  test("removes forwarded-thread facts when the procurement email thread is deleted", async () => {
    const fixture = await seedFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const ids = await fixture.t.run(async (ctx) => {
      const requestId = await ctx.db.insert("procurementRequests", {
        clientOrgId: fixture.clientOrgId,
        title: "Fleet renewal",
        requestSummary: "Renew the fleet program",
        requirements: "Commercial auto coverage",
        status: "marketing",
        inboxToken: "thread-lifecycle-token",
        createdByUserId: fixture.operatorUserId,
        updatedByUserId: fixture.operatorUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      const emailThreadId = await ctx.db.insert("procurementEmailThreads", {
        clientOrgId: fixture.clientOrgId,
        addressedRequestId: requestId,
        requestId,
        normalizedSubject: "fleet renewal",
        subject: "Fwd: Fleet renewal",
        category: "broker",
        categorySource: "auto",
        participantEmails: ["broker@example.com"],
        latestMessageAt: 200,
        messageCount: 1,
        createdAt: 200,
        updatedAt: 200,
      });
      await ctx.db.insert("procurementEmailMessages", {
        threadId: emailThreadId,
        clientOrgId: fixture.clientOrgId,
        addressedRequestId: requestId,
        references: [],
        subject: "Fwd: Fleet renewal",
        fromEmail: "operator@spot.insure",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Broker requires five years of loss runs.",
        clientFileIds: [],
        receivedAt: 200,
        createdAt: 200,
      });
      return { requestId, emailThreadId };
    });

    const claim = await fixture.t.mutation(
      internal.companyInformation.claimEmailThreadInternal,
      { emailThreadId: ids.emailThreadId },
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected source claim");
    await fixture.t.mutation(
      internal.companyInformation.completeEmailThreadInternal,
      {
        emailThreadId: ids.emailThreadId,
        sourceFingerprint: claim.source.sourceFingerprint,
        profile: profile(),
        organizationFacts: [
          {
            content: "Cove owns and operates 18 commercial vehicles.",
            confidence: 0.96,
          },
        ],
        procurementFacts: [
          {
            kind: "submission_requirement",
            content: "The broker requires five years of loss runs for Cove's fleet submission.",
            confidence: 0.97,
          },
        ],
      },
    );

    await operator.mutation(api.procurementRequests.removeEmailThread, {
      emailThreadId: ids.emailThreadId,
    });

    const state = await fixture.t.run(async (ctx) => ({
      thread: await ctx.db.get(ids.emailThreadId),
      memory: await ctx.db.query("orgMemory").collect(),
      procurement: await ctx.db.query("procurementMemory").collect(),
      extractions: await ctx.db
        .query("companyInformationExtractions")
        .collect(),
    }));
    expect(state.thread?.deletedAt).toEqual(expect.any(Number));
    expect(state.memory).toEqual([]);
    expect(state.procurement).toEqual([]);
    expect(state.extractions).toEqual([]);
  });
});
