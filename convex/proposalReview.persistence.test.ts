/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { saveGeneratedReviewInternal } from "./procurementProposals";

const modules = import.meta.glob("./**/*.ts");
const saveFn = saveGeneratedReviewInternal as any;

describe("proposal review persistence authorization", () => {
  test("rejects a durable model review while the operator is impersonating", async () => {
    const t = convexTest(schema, modules);
    const now = dayjs().valueOf();
    const fixture = await t.run(async (ctx) => {
      const operatorUserId = await ctx.db.insert("users", {
        name: "Operator",
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
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      const requestId = await ctx.db.insert("procurementRequests", {
        clientOrgId,
        title: "Placement",
        narrative: "Place coverage",
        status: "proposal_review",
        inboxToken: "review-auth",
        requirementRevision: 0,
        specificationRevision: 0,
        createdByUserId: operatorUserId,
        updatedByUserId: operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
        requestId,
        clientOrgId,
        brokerOrgId,
        brokerName: "Broker",
        status: "quote_received",
        applicationQuestions: [],
        createdByUserId: operatorUserId,
        updatedByUserId: operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      const proposalId = await ctx.db.insert("procurementProposals", {
        requestId,
        clientOrgId,
        brokerOrgId,
        outreachId,
        status: "review_ready",
        extractionFingerprint: "review-fingerprint",
        extractedOffer: { carrier: "Carrier" },
        createdByUserId: operatorUserId,
        updatedByUserId: operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId,
        targetOrgId: clientOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: now,
      });
      return { operatorUserId, proposalId };
    });

    await expect(
      t.mutation(saveFn, {
        operatorUserId: fixture.operatorUserId,
        proposalId: fixture.proposalId,
        extractionFingerprint: "review-fingerprint",
        packetRevision: 0,
        findings: [],
        conclusion: "insufficient_evidence",
      }),
    ).rejects.toThrow("IMPERSONATION_READ_ONLY");
    const reviews = await t.run((ctx) =>
      ctx.db.query("procurementProposalReviews").collect(),
    );
    expect(reviews).toEqual([]);
  });
});
