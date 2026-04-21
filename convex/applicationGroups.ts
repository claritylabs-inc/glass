import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertCanAnswerApplication, assertCanReviewApplication } from "./lib/applicationCapabilities";
import { internal } from "./_generated/api";
import { notify } from "./lib/notify";

export const submit = mutation({
  args: { groupId: v.id("applicationGroups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    await assertCanAnswerApplication(ctx, group.applicationId);

    // Validate all required, visible questions have answers
    const questions = await ctx.db
      .query("applicationQuestions")
      .withIndex("by_groupId", (q) => q.eq("groupId", args.groupId))
      .collect();
    const answers = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", group.applicationId))
      .collect();
    const answerMap = Object.fromEntries(
      answers.map((a) => [`${a.questionId}:${a.rowKey ?? ""}`, a]),
    );
    for (const q of questions) {
      if (q.required && !answerMap[`${q._id}:`]) {
        throw new Error(`Required question "${q.prompt}" has no answer`);
      }
    }

    await ctx.db.patch(args.groupId, {
      status: "submitted",
      submittedAt: Date.now(),
    });
    // Clear any open needs_new_answer flags on this group's answers
    const flags = await ctx.db
      .query("applicationQuestionFlags")
      .withIndex("by_groupId_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "open"),
      )
      .collect();
    for (const flag of flags) {
      if (flag.flagType === "needs_new_answer") {
        await ctx.db.patch(flag._id, { status: "resolved", resolvedAt: Date.now() });
      }
    }
    await ctx.runMutation((internal as any).applications.recomputeStatus, {
      applicationId: group.applicationId,
    });

    // Notify broker of submission
    const app = await ctx.db.get(group.applicationId);
    if (app) {
      const clientOrg = await ctx.db.get(app.clientOrgId);
      await notify(ctx, {
        orgId: app.brokerOrgId,
        type: "application_submitted_by_client",
        title: "Application submitted",
        body: `${clientOrg?.name ?? "Your client"} submitted a section.`,
        relatedOrgId: app.clientOrgId,
        actionType: "view_application",
        actionPayload: { applicationId: group.applicationId },
        coalesceKeyParts: ["application_submitted_by_client", app.brokerOrgId, app.clientOrgId],
      });
    }
  },
});

export const acceptSection = mutation({
  args: { groupId: v.id("applicationGroups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    await assertCanReviewApplication(ctx, group.applicationId);
    if (group.status !== "submitted") throw new Error("Group must be submitted to accept");
    await ctx.db.patch(args.groupId, { status: "accepted", reviewedAt: Date.now() });
    await ctx.runMutation((internal as any).applications.recomputeStatus, {
      applicationId: group.applicationId,
    });

    // Notify client of section acceptance
    const app = await ctx.db.get(group.applicationId);
    if (app) {
      const brokerOrg = await ctx.db.get(app.brokerOrgId);
      await notify(ctx, {
        orgId: app.clientOrgId,
        type: "application_accepted_by_broker",
        title: "Application accepted",
        body: `${brokerOrg?.name ?? "Your broker"} accepted your application.`,
        relatedOrgId: app.brokerOrgId,
        actionType: "view_application",
        actionPayload: { applicationId: group.applicationId },
      });
    }
  },
});

export const returnSection = mutation({
  args: { groupId: v.id("applicationGroups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    await assertCanReviewApplication(ctx, group.applicationId);
    if (group.status !== "submitted") throw new Error("Group must be submitted to return");
    // Require at least one open needs_new_answer flag
    const openFlags = await ctx.db
      .query("applicationQuestionFlags")
      .withIndex("by_groupId_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "open"),
      )
      .collect();
    const hasReturnFlag = openFlags.some((f) => f.flagType === "needs_new_answer");
    if (!hasReturnFlag) {
      throw new Error("Cannot return section without at least one 'needs new answer' flag");
    }
    await ctx.db.patch(args.groupId, { status: "returned", reviewedAt: Date.now() });
    // Mark flagged answers as needs_new_answer
    for (const flag of openFlags) {
      if (flag.flagType === "needs_new_answer") {
        const answer = await ctx.db
          .query("applicationAnswers")
          .withIndex("by_questionId", (q) => q.eq("questionId", flag.questionId))
          .first();
        if (answer) await ctx.db.patch(answer._id, { status: "needs_new_answer" });
      }
    }
    await ctx.runMutation((internal as any).applications.recomputeStatus, {
      applicationId: group.applicationId,
    });

    // Notify client of section return
    const app = await ctx.db.get(group.applicationId);
    if (app) {
      const brokerOrg = await ctx.db.get(app.brokerOrgId);
      await notify(ctx, {
        orgId: app.clientOrgId,
        type: "application_section_returned_by_broker",
        title: "Section returned for revision",
        body: `${brokerOrg?.name ?? "Your broker"} returned a section of your application.`,
        relatedOrgId: app.brokerOrgId,
        actionType: "view_application",
        actionPayload: { applicationId: group.applicationId },
      });
    }
  },
});
