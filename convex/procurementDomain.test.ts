/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules); const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", { name: "Operator", email: "operator@example.com", accountKind: "operator" });
    const clientUserId = await ctx.db.insert("users", { name: "Client", email: "client@example.com", accountKind: "customer" });
    const brokerUserId = await ctx.db.insert("users", { name: "Broker", email: "broker@example.com", accountKind: "customer" });
    const clientOrgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const brokerOrgId = await ctx.db.insert("organizations", { name: "Broker", type: "broker" });
    await ctx.db.insert("operatorProfiles", { userId: operatorUserId, email: "operator@example.com", role: "operator", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMemberships", { orgId: clientOrgId, userId: clientUserId, role: "admin" });
    await ctx.db.insert("orgMemberships", { orgId: brokerOrgId, userId: brokerUserId, role: "member" });
    return { operatorUserId, clientUserId, brokerUserId, clientOrgId, brokerOrgId };
  });
  return { t, ...ids, operator: t.withIdentity({ subject: `${ids.operatorUserId}|session` }), client: t.withIdentity({ subject: `${ids.clientUserId}|session` }), broker: t.withIdentity({ subject: `${ids.brokerUserId}|session` }) };
}

describe("procurement domain boundaries", () => {
  test("lets clients collaborate through an allowlisted request DTO without exposing private proposals", async () => {
    const f = await fixture();
    const created = await f.client.mutation(api.clientProcurementRequests.create, { title: "Property renewal", narrative: "We need property coverage" });
    const outreach = await f.operator.mutation(api.procurementRequests.createOutreach, { requestId: created.requestId, brokerOrgId: f.brokerOrgId, brokerName: "Broker" });
    await f.operator.mutation(api.procurementProposals.create, { requestId: created.requestId, brokerOrgId: f.brokerOrgId, outreachId: outreach.outreachId });
    const dto = await f.client.query(api.clientProcurementRequests.get, { requestId: created.requestId });
    expect(dto).toMatchObject({ title: "Property renewal", status: "submitted", narrative: "We need property coverage" });
    expect(dto).not.toHaveProperty("proposals");
    expect(dto).not.toHaveProperty("outreaches");
    expect(dto).not.toHaveProperty("emailThreads");
    await expect(f.client.query(api.procurementProposals.list, { requestId: created.requestId })).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(f.broker.query(api.clientProcurementRequests.get, { requestId: created.requestId })).rejects.toThrow("Client membership required");
  });

  test("requires proposal broker consistency and invalidates a confirmed review when a joined requirement changes", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, { clientOrgId: f.clientOrgId, title: "Placement", requestSummary: "Place coverage", requirements: "GL $1m", clientVisible: true });
    const outreach = await f.operator.mutation(api.procurementRequests.createOutreach, { requestId: request.requestId, brokerOrgId: f.brokerOrgId, brokerName: "Broker" });
    const otherBrokerId = await f.t.run((ctx) => ctx.db.insert("organizations", { name: "Other", type: "broker" }));
    await expect(f.operator.mutation(api.procurementProposals.create, { requestId: request.requestId, brokerOrgId: otherBrokerId, outreachId: outreach.outreachId })).rejects.toThrow("match its outreach");
    const proposal = await f.operator.mutation(api.procurementProposals.create, { requestId: request.requestId, brokerOrgId: f.brokerOrgId, outreachId: outreach.outreachId });
    const requirementId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("insuranceRequirements", { orgId: f.clientOrgId, kind: "coverage", scope: "own_org", title: "General liability", requirementText: "Maintain GL", lineOfBusiness: "CGL", limits: [{ kind: "each_occurrence", amount: 1_000_000 }], status: "active", createdByUserId: f.operatorUserId, updatedByUserId: f.operatorUserId, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("procurementRequestRequirements", { requestId: request.requestId, clientOrgId: f.clientOrgId, requirementId: id, addedByUserId: f.operatorUserId, createdAt: 1 });
      await ctx.db.patch(proposal.proposalId, { status: "review_ready", extractionFingerprint: "fp-1", extractedOffer: { premiumAmount: 1000 } });
      return id;
    });
    const review = await f.t.mutation(internal.procurementProposals.saveGeneratedReviewInternal, { operatorUserId: f.operatorUserId, proposalId: proposal.proposalId, extractionFingerprint: "fp-1", requirementRevision: 0, specificationRevision: 0, findings: [], conclusion: "has_gaps" });
    await f.operator.mutation(api.procurementProposals.confirmReview, { reviewId: review.reviewId, conclusion: "has_gaps" });
    await f.operator.mutation(api.compliance.upsertRequirement, { orgId: f.clientOrgId, requirementId, kind: "coverage", scope: "own_org", title: "General liability", requirementText: "Maintain higher GL", lineOfBusiness: "CGL", limits: [{ kind: "each_occurrence", amount: 2_000_000 }] });
    await expect(f.operator.mutation(api.procurementProposals.select, { proposalId: proposal.proposalId })).rejects.toThrow("current staff-confirmed review");
  });

  test("supports broker profiles without users and keeps member edits read-only", async () => {
    const f = await fixture();
    const standalone = await f.operator.mutation(api.brokerProfiles.createStandalone, { name: "No Portal Broker", networkStatus: "prospect", writingStates: ["ca"], lineOfBusinessCodes: ["cgl"] });
    const rows = await f.operator.query(api.brokerProfiles.list, { writingState: "CA", lineOfBusinessCode: "CGL" });
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ broker: expect.objectContaining({ _id: standalone.brokerOrgId }), contacts: [] })]));
    await expect(f.broker.mutation(api.brokerProfiles.upsert, { brokerOrgId: f.brokerOrgId, networkStatus: "active", writingStates: ["CA"], lineOfBusinessCodes: ["CGL"] })).rejects.toThrow("Broker admin required");
  });
});
