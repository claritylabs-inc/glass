import dayjs from "dayjs";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

async function request(ctx: MutationCtx, requestId: Id<"procurementRequests">) {
  const row = await ctx.db.get(requestId);
  if (!row) throw new Error("Procurement request not found");
  return row;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required`);
  return value.trim();
}

function semanticKey(value: Record<string, unknown>) {
  return JSON.stringify({
    kind: value.kind ?? "coverage",
    scope: value.scope ?? "own_org",
    title: String(value.title ?? "")
      .trim()
      .toLowerCase(),
    requirementText: String(value.requirementText ?? "")
      .trim()
      .toLowerCase(),
    lineOfBusiness: String(value.lineOfBusiness ?? "")
      .trim()
      .toUpperCase(),
    limits: value.limits ?? [],
    maxDeductible: value.maxDeductible,
    coverageForm: value.coverageForm,
    provisions: value.provisions ?? [],
    requiredForms: value.requiredForms ?? [],
    minAmBestRating: value.minAmBestRating,
    minAmBestFinancialSize: value.minAmBestFinancialSize,
    admittedRequired: value.admittedRequired,
    conditionType: value.conditionType,
    noticeDays: value.noticeDays,
  });
}

export const list = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const [drafts, links, specifications] = await Promise.all([
      ctx.db
        .query("procurementRequirementDrafts")
        .withIndex("request", (q) => q.eq("requestId", args.requestId))
        .collect(),
      ctx.db
        .query("procurementRequestRequirements")
        .withIndex("request", (q) => q.eq("requestId", args.requestId))
        .collect(),
      ctx.db
        .query("procurementSpecifications")
        .withIndex("request", (q) => q.eq("requestId", args.requestId))
        .collect(),
    ]);
    const requirements = (
      await Promise.all(links.map((link) => ctx.db.get(link.requirementId)))
    ).filter(Boolean);
    return { drafts, requirements, specifications };
  },
});

export const stageDrafts = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    requirements: v.array(
      v.object({
        proposedRequirement: v.any(),
        matchingRequirementId: v.optional(v.id("insuranceRequirements")),
        sourceExcerpt: v.optional(v.string()),
        sourcePageStart: v.optional(v.number()),
        sourcePageEnd: v.optional(v.number()),
      }),
    ),
    specifications: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          value: v.string(),
          sourceExcerpt: v.optional(v.string()),
          sourcePageStart: v.optional(v.number()),
          sourcePageEnd: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const req = await request(ctx, args.requestId);
    const now = dayjs().valueOf();
    const draftIds = [];
    for (const draft of args.requirements) {
      if (draft.matchingRequirementId) {
        const existing = await ctx.db.get(draft.matchingRequirementId);
        if (
          !existing ||
          existing.orgId !== req.clientOrgId ||
          existing.status !== "active"
        )
          throw new Error("Matching requirement not found");
      }
      draftIds.push(
        await ctx.db.insert("procurementRequirementDrafts", {
          requestId: req._id,
          clientOrgId: req.clientOrgId,
          ...draft,
          status: "draft",
          createdByUserId: operator.userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    if (args.specifications) {
      for (const item of args.specifications) {
        const key = text(item.key, "Specification key")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_");
        const existing = await ctx.db
          .query("procurementSpecifications")
          .withIndex("request_key", (q) =>
            q.eq("requestId", req._id).eq("key", key),
          )
          .unique();
        const patch = {
          label: text(item.label, "Specification label"),
          value: text(item.value, "Specification value"),
          sourceExcerpt: item.sourceExcerpt?.trim() || undefined,
          sourcePageStart: item.sourcePageStart,
          sourcePageEnd: item.sourcePageEnd,
          updatedByUserId: operator.userId,
          updatedAt: now,
        };
        if (existing) await ctx.db.patch(existing._id, patch);
        else
          await ctx.db.insert("procurementSpecifications", {
            requestId: req._id,
            clientOrgId: req.clientOrgId,
            key,
            ...patch,
            createdByUserId: operator.userId,
            createdAt: now,
          });
      }
      await ctx.db.patch(req._id, {
        specificationRevision: (req.specificationRevision ?? 0) + 1,
        updatedByUserId: operator.userId,
        updatedAt: now,
      });
    }
    return { draftIds };
  },
});

export const getIntakeExtractionContextInternal = internalQuery({
  args: {
    requestId: v.id("procurementRequests"),
    operatorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const procurementRequest = await ctx.db.get(args.requestId);
    if (!procurementRequest) throw new Error("Procurement request not found");
    const activeRequirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", procurementRequest.clientOrgId).eq("status", "active"),
      )
      .collect();
    return {
      requestId: procurementRequest._id,
      clientOrgId: procurementRequest.clientOrgId,
      title: procurementRequest.title,
      originalNarrative: procurementRequest.originalNarrative,
      requestSummary: procurementRequest.requestSummary,
      legacyRequirements: procurementRequest.requirements,
      activeRequirements,
    };
  },
});

export const stageExtractedDraftsInternal = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    operatorUserId: v.id("users"),
    requirements: v.array(
      v.object({
        proposedRequirement: v.any(),
        sourceExcerpt: v.optional(v.string()),
      }),
    ),
    specifications: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        value: v.string(),
        sourceExcerpt: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const impersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", args.operatorUserId).eq("status", "active"),
      )
      .first();
    if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
    const req = await request(ctx, args.requestId);
    const [activeRequirements, existingDrafts] = await Promise.all([
      ctx.db
        .query("insuranceRequirements")
        .withIndex("organization_status", (q) =>
          q.eq("orgId", req.clientOrgId).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("procurementRequirementDrafts")
        .withIndex("status", (q) =>
          q.eq("requestId", req._id).eq("status", "draft"),
        )
        .collect(),
    ]);
    const now = dayjs().valueOf();
    const draftIds = [];
    for (const draft of args.requirements) {
      const proposed = draft.proposedRequirement as Record<string, unknown>;
      const key = semanticKey(proposed);
      const matchingRequirement = activeRequirements.find(
        (row) => semanticKey(row as unknown as Record<string, unknown>) === key,
      );
      const existingDraft = existingDrafts.find(
        (row) =>
          semanticKey(row.proposedRequirement as Record<string, unknown>) ===
          key,
      );
      const values = {
        proposedRequirement: draft.proposedRequirement,
        matchingRequirementId: matchingRequirement?._id,
        sourceExcerpt: draft.sourceExcerpt?.trim() || undefined,
        updatedAt: now,
      };
      if (existingDraft) {
        await ctx.db.patch(existingDraft._id, values);
        draftIds.push(existingDraft._id);
      } else {
        draftIds.push(
          await ctx.db.insert("procurementRequirementDrafts", {
            requestId: req._id,
            clientOrgId: req.clientOrgId,
            ...values,
            status: "draft",
            createdByUserId: args.operatorUserId,
            createdAt: now,
          }),
        );
      }
    }

    for (const item of args.specifications) {
      const key = text(item.key, "Specification key")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
      const existing = await ctx.db
        .query("procurementSpecifications")
        .withIndex("request_key", (q) =>
          q.eq("requestId", req._id).eq("key", key),
        )
        .unique();
      const values = {
        label: text(item.label, "Specification label"),
        value: text(item.value, "Specification value"),
        sourceExcerpt: item.sourceExcerpt?.trim() || undefined,
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else
        await ctx.db.insert("procurementSpecifications", {
          requestId: req._id,
          clientOrgId: req.clientOrgId,
          key,
          ...values,
          createdByUserId: args.operatorUserId,
          createdAt: now,
        });
    }
    if (args.specifications.length > 0) {
      await ctx.db.patch(req._id, {
        specificationRevision: (req.specificationRevision ?? 0) + 1,
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
    }
    return { draftIds, specificationCount: args.specifications.length };
  },
});

export async function confirmProcurementRequirementDraftByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    draftId: Id<"procurementRequirementDrafts">;
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  const impersonation = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", args.operatorUserId).eq("status", "active"),
    )
    .first();
  if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
  const draft = await ctx.db.get(args.draftId);
  if (!draft || draft.status !== "draft")
    throw new Error("Requirement draft not found");
  const req = await request(ctx, draft.requestId);
  const proposed = draft.proposedRequirement as Record<string, unknown>;
  const active = await ctx.db
    .query("insuranceRequirements")
    .withIndex("organization_status", (q) =>
      q.eq("orgId", req.clientOrgId).eq("status", "active"),
    )
    .collect();
  let requirement = draft.matchingRequirementId
    ? await ctx.db.get(draft.matchingRequirementId)
    : active.find(
        (row) =>
          semanticKey(row as unknown as Record<string, unknown>) ===
          semanticKey(proposed),
      );
  if (
    requirement &&
    (requirement.orgId !== req.clientOrgId || requirement.status !== "active")
  )
    throw new Error("Matching requirement not found");
  const now = dayjs().valueOf();
  if (!requirement) {
    const kind =
      proposed.kind === "insurer" || proposed.kind === "condition"
        ? proposed.kind
        : "coverage";
    const lineOfBusiness =
      typeof proposed.lineOfBusiness === "string" &&
      proposed.lineOfBusiness.trim()
        ? proposed.lineOfBusiness.trim().toUpperCase()
        : undefined;
    if (kind === "coverage" && !lineOfBusiness)
      throw new Error("Line of business is required");
    const requirementId = await ctx.db.insert("insuranceRequirements", {
      orgId: req.clientOrgId,
      kind,
      scope: proposed.scope === "vendors" ? "vendors" : "own_org",
      title: text(proposed.title, "Title"),
      requirementText: text(proposed.requirementText, "Requirement text"),
      lineOfBusiness,
      limits: Array.isArray(proposed.limits)
        ? (proposed.limits as Array<{
            kind: string;
            amount: number;
            label?: string;
          }>)
        : [],
      maxDeductible: proposed.maxDeductible as
        | { amount: number; label?: string }
        | undefined,
      coverageForm: proposed.coverageForm as
        | "occurrence"
        | "claims_made"
        | undefined,
      retroactiveDateOnOrBefore: proposed.retroactiveDateOnOrBefore as
        | string
        | undefined,
      provisions: Array.isArray(proposed.provisions)
        ? (proposed.provisions as string[])
        : [],
      requiredForms: Array.isArray(proposed.requiredForms)
        ? (proposed.requiredForms as string[])
        : [],
      minAmBestRating:
        typeof proposed.minAmBestRating === "string"
          ? proposed.minAmBestRating
          : undefined,
      minAmBestFinancialSize:
        typeof proposed.minAmBestFinancialSize === "string"
          ? proposed.minAmBestFinancialSize
          : undefined,
      admittedRequired:
        typeof proposed.admittedRequired === "boolean"
          ? proposed.admittedRequired
          : undefined,
      conditionType: proposed.conditionType as
        | "cancellation_notice"
        | "certificate_delivery"
        | "claims_reporting"
        | "subcontractor_insurance"
        | "other"
        | undefined,
      noticeDays:
        typeof proposed.noticeDays === "number"
          ? proposed.noticeDays
          : undefined,
      sourceType: "manual",
      sourceExcerpt: draft.sourceExcerpt,
      sourcePageStart: draft.sourcePageStart,
      sourcePageEnd: draft.sourcePageEnd,
      status: "active",
      createdByUserId: args.operatorUserId,
      updatedByUserId: args.operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    requirement = await ctx.db.get(requirementId);
  }
  if (!requirement) throw new Error("Could not confirm requirement");
  const link = await ctx.db
    .query("procurementRequestRequirements")
    .withIndex("request_requirement", (q) =>
      q.eq("requestId", req._id).eq("requirementId", requirement!._id),
    )
    .unique();
  if (!link)
    await ctx.db.insert("procurementRequestRequirements", {
      requestId: req._id,
      clientOrgId: req.clientOrgId,
      requirementId: requirement._id,
      addedByUserId: args.operatorUserId,
      createdAt: now,
    });
  await ctx.db.patch(draft._id, {
    status: "confirmed",
    confirmedRequirementId: requirement._id,
    confirmedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  await ctx.db.patch(req._id, {
    requirementRevision: (req.requirementRevision ?? 0) + 1,
    updatedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: req.clientOrgId,
    summary: `Confirmed procurement requirement for ${req.title}`,
    metadata: {
      requestId: req._id,
      requirementId: requirement._id,
      reused: Boolean(link || draft.matchingRequirementId),
    },
  });
  return {
    requirementId: requirement._id,
    reused: Boolean(link || draft.matchingRequirementId),
  };
}

export const confirmDraft = mutation({
  args: { draftId: v.id("procurementRequirementDrafts") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await confirmProcurementRequirementDraftByOperator(ctx, {
      operatorUserId: operator.userId,
      draftId: args.draftId,
    });
  },
});

export const upsertSpecification = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    specificationId: v.optional(v.id("procurementSpecifications")),
    key: v.string(),
    label: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const req = await request(ctx, args.requestId);
    const now = dayjs().valueOf();
    const patch = {
      key: text(args.key, "Key")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_"),
      label: text(args.label, "Label"),
      value: text(args.value, "Value"),
      updatedByUserId: operator.userId,
      updatedAt: now,
    };
    let id = args.specificationId;
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.requestId !== req._id)
        throw new Error("Specification not found");
      await ctx.db.patch(id, patch);
    } else
      id = await ctx.db.insert("procurementSpecifications", {
        requestId: req._id,
        clientOrgId: req.clientOrgId,
        ...patch,
        createdByUserId: operator.userId,
        createdAt: now,
      });
    await ctx.db.patch(req._id, {
      specificationRevision: (req.specificationRevision ?? 0) + 1,
      updatedByUserId: operator.userId,
      updatedAt: now,
    });
    return id;
  },
});
