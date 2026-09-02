import dayjs from "dayjs";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOperator, requireOperatorForUser, writeOperatorAudit } from "./lib/operatorIdentity";

const conclusionValidator = v.union(v.literal("meets_requirements"), v.literal("has_gaps"), v.literal("insufficient_evidence"));

async function requireProposal(ctx: MutationCtx, proposalId: Id<"procurementProposals">) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) throw new Error("Proposal not found");
  return proposal;
}

async function requireDirectOperator(ctx: MutationCtx, operatorUserId: Id<"users">) {
  await requireOperatorForUser(ctx, operatorUserId);
  const impersonation = await ctx.db.query("operatorImpersonationSessions").withIndex("operator_status", (q) => q.eq("operatorUserId", operatorUserId).eq("status", "active")).first();
  if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
}

async function fingerprint(ctx: MutationCtx, proposalId: Id<"procurementProposals">) {
  const documents = await ctx.db.query("procurementProposalDocuments").withIndex("proposal", (q) => q.eq("proposalId", proposalId)).collect();
  if (!documents.length) throw new Error("Add at least one proposal document");
  return documents.sort((a, b) => String(a._id).localeCompare(String(b._id))).map((document) => `${document._id}:${document.sha256}`).join("|");
}

async function assertBrokerOutreach(ctx: MutationCtx, requestId: Id<"procurementRequests">, outreachId: Id<"procurementBrokerOutreaches">, brokerOrgId: Id<"organizations">) {
  const [request, outreach, broker] = await Promise.all([ctx.db.get(requestId), ctx.db.get(outreachId), ctx.db.get(brokerOrgId)]);
  if (!request) throw new Error("Procurement request not found");
  if (!broker || broker.type !== "broker") throw new Error("Broker organization not found");
  if (!outreach || outreach.requestId !== request._id) throw new Error("Outreach does not belong to this request");
  if (outreach.brokerOrgId !== broker._id) throw new Error("Proposal broker must match its outreach");
  return { request, outreach, broker };
}

async function proposalDto(ctx: QueryCtx, proposal: Doc<"procurementProposals">) {
  const [documents, reviews, broker] = await Promise.all([
    ctx.db.query("procurementProposalDocuments").withIndex("proposal", (q) => q.eq("proposalId", proposal._id)).collect(),
    ctx.db.query("procurementProposalReviews").withIndex("proposal", (q) => q.eq("proposalId", proposal._id)).order("desc").collect(),
    ctx.db.get(proposal.brokerOrgId),
  ]);
  const documentRows = await Promise.all(documents.map(async ({ fileId, ...document }) => ({ ...document, url: await ctx.storage.getUrl(fileId) })));
  return { ...proposal, brokerName: broker?.name, documents: documentRows, reviews };
}

export async function listProcurementProposals(ctx: QueryCtx, requestId: Id<"procurementRequests">) {
  const rows = await ctx.db.query("procurementProposals").withIndex("request", (q) => q.eq("requestId", requestId)).order("desc").collect();
  return await Promise.all(rows.map((row) => proposalDto(ctx, row)));
}

export async function getProcurementProposalDetails(ctx: QueryCtx, proposalId: Id<"procurementProposals">) {
  const proposal = await ctx.db.get(proposalId);
  return proposal ? proposalDto(ctx, proposal) : null;
}

export const list = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => { await requireOperator(ctx); return await listProcurementProposals(ctx, args.requestId); },
});

export const get = query({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => { await requireOperator(ctx); return await getProcurementProposalDetails(ctx, args.proposalId); },
});

export async function createProcurementProposalByOperator(ctx: MutationCtx, args: { operatorUserId: Id<"users">; requestId: Id<"procurementRequests">; brokerOrgId: Id<"organizations">; outreachId: Id<"procurementBrokerOutreaches">; supersedesProposalId?: Id<"procurementProposals"> }) {
  await requireDirectOperator(ctx, args.operatorUserId); const { request } = await assertBrokerOutreach(ctx, args.requestId, args.outreachId, args.brokerOrgId);
  if (args.supersedesProposalId) { const prior = await ctx.db.get(args.supersedesProposalId); if (!prior || prior.requestId !== request._id) throw new Error("Superseded proposal must belong to this request"); }
  const now = dayjs().valueOf();
  const proposalId = await ctx.db.insert("procurementProposals", { requestId: request._id, clientOrgId: request.clientOrgId, brokerOrgId: args.brokerOrgId, outreachId: args.outreachId, supersedesProposalId: args.supersedesProposalId, status: "draft", createdByUserId: args.operatorUserId, updatedByUserId: args.operatorUserId, createdAt: now, updatedAt: now });
  await writeOperatorAudit(ctx, { operatorUserId: args.operatorUserId, type: "setup_write", targetOrgId: request.clientOrgId, summary: `Created private proposal for ${request.title}`, metadata: { requestId: request._id, proposalId } });
  return { proposalId };
}

export const create = mutation({
  args: { requestId: v.id("procurementRequests"), brokerOrgId: v.id("organizations"), outreachId: v.id("procurementBrokerOutreaches"), supersedesProposalId: v.optional(v.id("procurementProposals")) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx); return await createProcurementProposalByOperator(ctx, { operatorUserId: operator.userId, ...args });
  },
});

export const generateUploadUrl = mutation({ args: { proposalId: v.id("procurementProposals") }, handler: async (ctx, args) => { await requireOperator(ctx); await requireProposal(ctx, args.proposalId); return await ctx.storage.generateUploadUrl(); } });

export const addDocument = mutation({
  args: { proposalId: v.id("procurementProposals"), fileId: v.id("_storage"), fileName: v.string(), contentType: v.string(), size: v.number(), sha256: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx); const proposal = await requireProposal(ctx, args.proposalId);
    if (["extracting", "selected", "withdrawn", "archived"].includes(proposal.status)) throw new Error("Proposal documents cannot be changed in this state");
    if (!(await ctx.storage.getMetadata(args.fileId))) throw new Error("Uploaded file not found");
    const now = dayjs().valueOf();
    const proposalDocumentId = await ctx.db.insert("procurementProposalDocuments", { proposalId: proposal._id, requestId: proposal.requestId, clientOrgId: proposal.clientOrgId, fileId: args.fileId, fileName: args.fileName.trim() || "Proposal.pdf", contentType: args.contentType, size: args.size, sha256: args.sha256.trim().toLowerCase(), createdByUserId: operator.userId, createdAt: now });
    await ctx.db.patch(proposal._id, { status: "draft", extractionFingerprint: undefined, extractedOffer: undefined, updatedByUserId: operator.userId, updatedAt: now });
    return { proposalDocumentId };
  },
});

export const queueExtraction = mutation({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx); const proposal = await requireProposal(ctx, args.proposalId);
    if (["selected", "withdrawn", "archived"].includes(proposal.status)) throw new Error("Proposal cannot be extracted in this state");
    const extractionFingerprint = await fingerprint(ctx, proposal._id); const now = dayjs().valueOf();
    const existing = await ctx.db.query("procurementProposalExtractionJobs").withIndex("fingerprint", (q) => q.eq("proposalId", proposal._id).eq("extractionFingerprint", extractionFingerprint)).order("desc").first();
    if (existing && ["pending", "running", "complete"].includes(existing.status)) return { jobId: existing._id, extractionFingerprint };
    const jobId = await ctx.db.insert("procurementProposalExtractionJobs", { proposalId: proposal._id, requestId: proposal.requestId, clientOrgId: proposal.clientOrgId, extractionFingerprint, requestedByUserId: operator.userId, status: "pending", attempts: 0, createdAt: now, updatedAt: now });
    await ctx.db.patch(proposal._id, { status: "extracting", extractionFingerprint, updatedByUserId: operator.userId, updatedAt: now });
    return { jobId, extractionFingerprint };
  },
});

export const getReviewInputInternal = internalQuery({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId); if (!proposal?.extractionFingerprint || !proposal.extractedOffer) return null;
    const request = await ctx.db.get(proposal.requestId); if (!request) return null;
    const [links, specifications] = await Promise.all([
      ctx.db.query("procurementRequestRequirements").withIndex("request", (q) => q.eq("requestId", request._id)).collect(),
      ctx.db.query("procurementSpecifications").withIndex("request", (q) => q.eq("requestId", request._id)).collect(),
    ]);
    const requirements = (await Promise.all(links.map((link) => ctx.db.get(link.requirementId)))).filter((row): row is Doc<"insuranceRequirements"> => Boolean(row?.status === "active"));
    return { proposalId: proposal._id, requestId: request._id, clientOrgId: request.clientOrgId, extractedOffer: proposal.extractedOffer, extractionFingerprint: proposal.extractionFingerprint, requirements, specifications, requirementRevision: request.requirementRevision ?? 0, specificationRevision: request.specificationRevision ?? 0 };
  },
});

export const saveGeneratedReviewInternal = internalMutation({
  args: { operatorUserId: v.id("users"), proposalId: v.id("procurementProposals"), extractionFingerprint: v.string(), requirementRevision: v.number(), specificationRevision: v.number(), findings: v.array(v.any()), conclusion: conclusionValidator },
  handler: async (ctx, args) => {
    await requireDirectOperator(ctx, args.operatorUserId);
    const proposal = await ctx.db.get(args.proposalId); if (!proposal || proposal.extractionFingerprint !== args.extractionFingerprint) throw new Error("Stale proposal extraction");
    const request = await ctx.db.get(proposal.requestId); if (!request || (request.requirementRevision ?? 0) !== args.requirementRevision || (request.specificationRevision ?? 0) !== args.specificationRevision) throw new Error("Stale procurement requirements");
    const now = dayjs().valueOf();
    const reviewId = await ctx.db.insert("procurementProposalReviews", { proposalId: proposal._id, requestId: request._id, clientOrgId: request.clientOrgId, extractionFingerprint: args.extractionFingerprint, requirementRevision: args.requirementRevision, specificationRevision: args.specificationRevision, modelConclusion: args.conclusion, findings: args.findings, createdAt: now, updatedAt: now });
    await ctx.db.patch(proposal._id, { status: "review_ready", updatedAt: now });
    return { reviewId };
  },
});

export async function confirmProcurementProposalReviewByOperator(ctx: MutationCtx, args: { operatorUserId: Id<"users">; reviewId: Id<"procurementProposalReviews">; conclusion: "meets_requirements" | "has_gaps" | "insufficient_evidence" }) {
  await requireDirectOperator(ctx, args.operatorUserId); const review = await ctx.db.get(args.reviewId); if (!review) throw new Error("Review not found");
  const proposal = await requireProposal(ctx, review.proposalId); const request = await ctx.db.get(review.requestId);
  if (!request || proposal.extractionFingerprint !== review.extractionFingerprint || (request.requirementRevision ?? 0) !== review.requirementRevision || (request.specificationRevision ?? 0) !== review.specificationRevision) throw new Error("Review is stale");
  const now = dayjs().valueOf(); await ctx.db.patch(review._id, { staffConclusion: args.conclusion, confirmedByUserId: args.operatorUserId, confirmedAt: now, updatedAt: now }); await ctx.db.patch(proposal._id, { status: "reviewed", updatedByUserId: args.operatorUserId, updatedAt: now });
  return { proposalId: proposal._id };
}

export const confirmReview = mutation({
  args: { reviewId: v.id("procurementProposalReviews"), conclusion: conclusionValidator },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx); return await confirmProcurementProposalReviewByOperator(ctx, { operatorUserId: operator.userId, ...args });
  },
});

export async function selectProcurementProposalByOperator(ctx: MutationCtx, args: { operatorUserId: Id<"users">; proposalId: Id<"procurementProposals"> }) {
  await requireDirectOperator(ctx, args.operatorUserId); const proposal = await requireProposal(ctx, args.proposalId); const request = await ctx.db.get(proposal.requestId); if (!request) throw new Error("Request not found");
  const reviews = await ctx.db.query("procurementProposalReviews").withIndex("proposal", (q) => q.eq("proposalId", proposal._id)).order("desc").collect();
  const current = reviews.find((review) => review.staffConclusion && review.extractionFingerprint === proposal.extractionFingerprint && review.requirementRevision === (request.requirementRevision ?? 0) && review.specificationRevision === (request.specificationRevision ?? 0));
  if (!current) throw new Error("A current staff-confirmed review is required");
  const selected = await ctx.db.query("procurementProposals").withIndex("request_status", (q) => q.eq("requestId", request._id).eq("status", "selected")).collect();
  const now = dayjs().valueOf(); for (const prior of selected) if (prior._id !== proposal._id) await ctx.db.patch(prior._id, { status: "reviewed", selectedAt: undefined, selectedByUserId: undefined, updatedByUserId: args.operatorUserId, updatedAt: now });
  await ctx.db.patch(proposal._id, { status: "selected", selectedAt: now, selectedByUserId: args.operatorUserId, updatedByUserId: args.operatorUserId, updatedAt: now });
  await ctx.db.patch(request._id, { status: "binding", updatedByUserId: args.operatorUserId, updatedAt: now });
  return { proposalId: proposal._id, reviewId: current._id, conclusion: current.staffConclusion };
}

export const select = mutation({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx); return await selectProcurementProposalByOperator(ctx, { operatorUserId: operator.userId, ...args });
  },
});
