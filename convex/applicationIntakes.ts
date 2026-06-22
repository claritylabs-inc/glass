import { v } from "convex/values";
import dayjs from "dayjs";
import {
  ApplicationQuestionGraphSchema,
  ApplicationTemplateSchema,
  applyApplicationAnswers as applySdkApplicationAnswers,
  buildApplicationPacket as buildSdkApplicationPacket,
  createApplicationRun as createSdkApplicationRun,
  extractQuestionGraphFromFields,
  flattenQuestionGraph,
  getActiveApplicationFields,
  proposeContextWrites as proposeSdkContextWrites,
  validateApplicationPacket as validateSdkApplicationPacket,
  type ApplicationContextProposal,
  type ApplicationField,
  type ApplicationQuestionGraph,
  type ApplicationState,
  type ApplicationTemplate,
} from "@claritylabs/cl-sdk/application";
import {
  internalQuery,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertBrokerOrg,
  getOrgAccess,
  requireCurrentOrgAccess,
  type OrgAccess,
} from "./lib/access";
import { notify } from "./lib/notify";

type Ctx = QueryCtx | MutationCtx;

const sourceKindValidator = v.union(
  v.literal("web"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("mcp"),
  v.literal("broker_portal"),
  v.literal("operator"),
);

const templateStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("archived"),
);

const answerValidator = v.object({
  fieldId: v.string(),
  label: v.string(),
  section: v.optional(v.string()),
  value: v.string(),
  source: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  userSourceSpanIds: v.optional(v.array(v.string())),
});

const missingQuestionValidator = v.object({
  fieldId: v.string(),
  label: v.string(),
  section: v.optional(v.string()),
  prompt: v.string(),
  required: v.boolean(),
});

function nowMs() {
  return dayjs().valueOf();
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function assertCanWriteApplication(access: OrgAccess) {
  if (access.accessType === "connected_client") {
    throw new Error("Connected clients have read-only access");
  }
}

function brokerOrgIdForAccess(access: OrgAccess): Id<"organizations"> | undefined {
  if (access.accessType === "broker_of_client") return access.brokerOrgId;
  return access.org.brokerOrgId;
}

async function getWritableApplicationAccess(ctx: Ctx, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  assertCanWriteApplication(access);
  return {
    access,
    brokerOrgId: brokerOrgIdForAccess(access),
  };
}

async function getWritableApplicationAccessForUser(
  ctx: Ctx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");

  const directMembership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .first();
  if (directMembership) {
    return {
      org,
      accessType: "member" as const,
      brokerOrgId: org.brokerOrgId as Id<"organizations"> | undefined,
    };
  }

  if (org.type === "client" && org.brokerOrgId) {
    const brokerMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", org.brokerOrgId!).eq("userId", userId),
      )
      .first();
    if (brokerMembership) {
      return {
        org,
        accessType: "broker_of_client" as const,
        brokerOrgId: org.brokerOrgId,
      };
    }
  }

  throw new Error("Unauthorized");
}

type ApplicationAnswerInput = {
  fieldId: string;
  label: string;
  section?: string;
  value: string;
  source?: string;
  sourceSpanIds?: string[];
  userSourceSpanIds?: string[];
};

function parseQuestionGraph(questionGraph: unknown): ApplicationQuestionGraph | undefined {
  const jsonGraph = toJsonValue(questionGraph);
  if (!jsonGraph) return undefined;
  const parsed = ApplicationQuestionGraphSchema.safeParse(jsonGraph);
  return parsed.success ? parsed.data : undefined;
}

function parseTemplateSnapshot(templateSnapshot: unknown): ApplicationTemplate | undefined {
  if (!templateSnapshot) return undefined;
  const parsed = ApplicationTemplateSchema.safeParse(templateSnapshot);
  return parsed.success ? parsed.data : undefined;
}

function fieldFromQuestion(question: {
  fieldId: string;
  label: string;
  section?: string;
  prompt?: string;
  required: boolean;
}): ApplicationField {
  return {
    id: question.fieldId,
    label: question.prompt ?? question.label,
    section: question.section ?? "Application",
    fieldType: "text",
    required: question.required,
  };
}

function fieldsFromStoredIntake(intake: Doc<"applicationIntakes">): ApplicationField[] {
  const byFieldId = new Map<string, ApplicationField>();
  for (const question of intake.missingQuestions) {
    byFieldId.set(question.fieldId, fieldFromQuestion(question));
  }
  for (const answer of intake.normalizedAnswers) {
    byFieldId.set(answer.fieldId, {
      id: answer.fieldId,
      label: answer.label,
      section: answer.section ?? "Application",
      fieldType: "text",
      required: false,
      value: answer.value,
      source: answer.source,
      confidence: "confirmed",
      sourceSpanIds: answer.sourceSpanIds,
      userSourceSpanIds: answer.userSourceSpanIds,
      validationStatus: "valid",
    });
  }
  return [...byFieldId.values()];
}

function buildManualQuestionGraph(args: {
  id: string;
  title?: string;
  applicationType?: string;
  fields: ApplicationField[];
}): ApplicationQuestionGraph {
  return extractQuestionGraphFromFields(args.fields, {
    id: args.id,
    version: "v1",
    title: args.title,
    applicationType: args.applicationType ?? null,
    source: "manual",
  });
}

function buildSdkTemplate(args: {
  id: string;
  version: string;
  title: string;
  applicationType?: string | null;
  questionGraph?: unknown;
  fields?: ApplicationField[];
}): ApplicationTemplate {
  const parsedGraph = parseQuestionGraph(args.questionGraph);
  const fields = args.fields?.length
    ? args.fields
    : parsedGraph
      ? flattenQuestionGraph(parsedGraph)
      : [];
  const questionGraph = parsedGraph
    ?? buildManualQuestionGraph({
      id: `${args.id}:graph`,
      title: args.title,
      applicationType: args.applicationType ?? undefined,
      fields,
    });

  return {
    id: args.id,
    version: args.version,
    title: args.title,
    applicationType: args.applicationType,
    questionGraph,
    fields,
  };
}

function buildTemplateForStart(args: {
  template: Doc<"applicationTemplates"> | null;
  fallbackId: string;
  fallbackVersion: string;
  title?: string;
  applicationType?: string;
  questionGraph?: unknown;
  missingQuestions?: Array<{
    fieldId: string;
    label: string;
    section?: string;
    prompt: string;
    required: boolean;
  }>;
}): ApplicationTemplate {
  const fields = args.missingQuestions?.map(fieldFromQuestion) ?? [];
  return buildSdkTemplate({
    id: args.template ? String(args.template._id) : args.fallbackId,
    version: args.template?.version ?? args.fallbackVersion,
    title: args.title ?? args.template?.title ?? "Insurance application",
    applicationType: args.applicationType ?? args.template?.applicationType ?? null,
    questionGraph: args.questionGraph ?? args.template?.questionGraph,
    fields,
  });
}

function buildStateForIntake(intake: Doc<"applicationIntakes">): ApplicationState {
  const parsedTemplate = parseTemplateSnapshot(intake.templateSnapshot);
  const fallbackFields = fieldsFromStoredIntake(intake);
  const template = parsedTemplate
    ?? buildSdkTemplate({
      id: String(intake.templateId ?? intake._id),
      version: intake.templateVersion ?? "v1",
      title: intake.title,
      applicationType: intake.applicationType ?? null,
      questionGraph: intake.questionGraph,
      fields: fallbackFields,
    });
  const baseState = createSdkApplicationRun({
    applicationId: String(intake._id),
    template,
    now: intake.createdAt,
  });
  const answeredState = applySdkApplicationAnswers(
    {
      ...baseState,
      status: glassStatusToSdkStatus(intake.status),
      updatedAt: intake.updatedAt,
    },
    intake.normalizedAnswers.map((answer) => ({
      fieldId: answer.fieldId,
      value: answer.value,
      source: answer.source,
      confidence: "confirmed",
      sourceSpanIds: answer.sourceSpanIds,
      userSourceSpanIds: answer.userSourceSpanIds,
    })),
    intake.updatedAt,
  );

  return {
    ...answeredState,
    status: glassStatusToSdkStatus(intake.status),
    updatedAt: intake.updatedAt,
  };
}

function glassStatusToSdkStatus(status: Doc<"applicationIntakes">["status"]): ApplicationState["status"] {
  if (status === "needs_broker_review") return "broker_review";
  if (status === "broker_ready") return "packet_ready";
  if (status === "submitted") return "submitted";
  if (status === "cancelled") return "cancelled";
  return "collecting";
}

function fieldToMissingQuestion(field: ApplicationField) {
  return {
    fieldId: field.id,
    label: field.label,
    section: field.section,
    prompt: field.label,
    required: field.required,
  };
}

function missingQuestionsFromState(state: ApplicationState) {
  return getActiveApplicationFields(state)
    .filter((field) => !field.value)
    .map(fieldToMissingQuestion);
}

function answerRowsFromState(
  state: ApplicationState,
  now: number,
  previousAnswers: Doc<"applicationIntakes">["normalizedAnswers"] = [],
) {
  const previousByFieldId = new Map(previousAnswers.map((answer) => [answer.fieldId, answer]));
  return getActiveApplicationFields(state)
    .filter((field) => field.value)
    .map((field) => {
      const value = field.value ?? "";
      const source = field.source ?? "user";
      const previous = previousByFieldId.get(field.id);
      const updatedAt = previous && previous.value === value && previous.source === source
        ? previous.updatedAt
        : now;
      return {
        fieldId: field.id,
        label: field.label,
        section: field.section,
        value,
        source,
        sourceSpanIds: field.sourceSpanIds,
        userSourceSpanIds: field.userSourceSpanIds,
        updatedAt,
      };
    });
}

function contextProposalsForAnswers(
  state: ApplicationState,
  answers: ApplicationAnswerInput[],
): ApplicationContextProposal[] {
  const answeredFieldIds = new Set(answers.map((answer) => answer.fieldId));
  return proposeSdkContextWrites(state).filter(
    (proposal) => !proposal.fieldId || answeredFieldIds.has(proposal.fieldId),
  );
}

async function recordBrokerActivity(
  ctx: MutationCtx,
  args: {
    brokerOrgId?: Id<"organizations">;
    clientOrgId: Id<"organizations">;
    userId?: Id<"users">;
    type: "application_sent" | "application_batch_submitted" | "application_completed";
    summary: string;
    payload?: unknown;
    now: number;
  },
) {
  if (!args.brokerOrgId) return;
  await ctx.db.insert("brokerActivity", {
    brokerOrgId: args.brokerOrgId,
    clientOrgId: args.clientOrgId,
    type: args.type,
    actorUserId: args.userId,
    actorSide: args.type === "application_sent" ? "system" : "client",
    payload: args.payload,
    summary: args.summary,
    createdAt: args.now,
  });
}

async function notifyBroker(
  ctx: MutationCtx,
  args: {
    brokerOrgId?: Id<"organizations">;
    clientOrgId: Id<"organizations">;
    intakeId: Id<"applicationIntakes">;
    type: "application_intake_started" | "application_intake_needs_review" | "application_packet_ready";
    title: string;
    body: string;
    now: number;
  },
) {
  if (!args.brokerOrgId) return;
  await notify(ctx, {
    orgId: args.brokerOrgId,
    type: args.type,
    title: args.title,
    body: args.body,
    relatedOrgId: args.clientOrgId,
    actionType: "view_application_intake",
    actionPayload: {
      applicationIntakeId: args.intakeId,
      clientOrgId: args.clientOrgId,
    },
    sourceRef: {
      applicationIntakeId: args.intakeId,
      clientOrgId: args.clientOrgId,
    },
    coalesceKeyParts: [args.type, String(args.intakeId)],
    nowMs: args.now,
  });
}

async function startIntake(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    userId?: Id<"users">;
    brokerOrgId?: Id<"organizations">;
    templateId?: Id<"applicationTemplates">;
    sourceKind: "web" | "email" | "imessage" | "mcp" | "broker_portal" | "operator";
    requestText?: string;
    title?: string;
    applicationType?: string;
    lineOfBusiness?: string;
    product?: string;
    threadId?: Id<"threads">;
    threadMessageId?: Id<"threadMessages">;
    questionGraph?: unknown;
    missingQuestions?: Array<{
      fieldId: string;
      label: string;
      section?: string;
      prompt: string;
      required: boolean;
    }>;
  },
) {
  const now = nowMs();
  const template = args.templateId ? await ctx.db.get(args.templateId) : null;
  if (args.templateId && !template) throw new Error("Application template not found");
  if (template && args.brokerOrgId && template.brokerOrgId !== args.brokerOrgId) {
    throw new Error("Template does not belong to this broker");
  }

  const sdkTemplate = buildTemplateForStart({
    template,
    fallbackId: `manual:${args.orgId}:${now}`,
    fallbackVersion: dayjs(now).format("YYYY.MM.DD-HHmmss"),
    title: args.title,
    applicationType: args.applicationType,
    questionGraph: args.questionGraph,
    missingQuestions: args.missingQuestions,
  });
  const sdkState = createSdkApplicationRun({
    applicationId: `pending:${args.orgId}:${now}`,
    template: sdkTemplate,
    now,
  });
  const missingQuestions = missingQuestionsFromState(sdkState);
  const intakeId = await ctx.db.insert("applicationIntakes", {
    orgId: args.orgId,
    brokerOrgId: args.brokerOrgId,
    templateId: template?._id,
    templateVersion: sdkTemplate.version,
    templateSnapshot: {
      ...sdkTemplate,
      lineOfBusiness: args.lineOfBusiness ?? template?.lineOfBusiness,
      product: args.product ?? template?.product,
    },
    title: sdkTemplate.title,
    applicationType: sdkTemplate.applicationType ?? undefined,
    lineOfBusiness: args.lineOfBusiness ?? template?.lineOfBusiness,
    product: args.product ?? template?.product,
    sourceKind: args.sourceKind,
    threadId: args.threadId,
    threadMessageId: args.threadMessageId,
    createdByUserId: args.userId,
    status: "collecting",
    requestText: args.requestText,
    questionGraph: sdkState.questionGraph,
    normalizedAnswers: [],
    missingQuestions,
    contextProposalCount: 0,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });

  if (args.requestText?.trim()) {
    await ctx.db.insert("applicationMessages", {
      applicationIntakeId: intakeId,
      orgId: args.orgId,
      brokerOrgId: args.brokerOrgId,
      sourceKind: args.sourceKind,
      role: "user",
      content: args.requestText.trim(),
      threadMessageId: args.threadMessageId,
      createdByUserId: args.userId,
      createdAt: now,
    });
  }

  await recordBrokerActivity(ctx, {
    brokerOrgId: args.brokerOrgId,
    clientOrgId: args.orgId,
    userId: args.userId,
    type: "application_sent",
    summary: `Application intake started: ${sdkTemplate.title}`,
    payload: { applicationIntakeId: intakeId },
    now,
  });
  await notifyBroker(ctx, {
    brokerOrgId: args.brokerOrgId,
    clientOrgId: args.orgId,
    intakeId,
    type: "application_intake_started",
    title: "Application intake started",
    body: sdkTemplate.title,
    now,
  });

  return await ctx.db.get(intakeId);
}

export const listTemplates = query({
  args: {
    status: v.optional(templateStatusValidator),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    assertBrokerOrg(access);
    const queryBuilder = args.status
      ? ctx.db
          .query("applicationTemplates")
          .withIndex("by_brokerOrgId_status", (q) =>
            q.eq("brokerOrgId", access.orgId).eq("status", args.status!),
          )
      : ctx.db
          .query("applicationTemplates")
          .withIndex("by_brokerOrgId_updatedAt", (q) =>
            q.eq("brokerOrgId", access.orgId),
          )
          .order("desc");
    return await queryBuilder.take(100);
  },
});

export const saveTemplate = mutation({
  args: {
    templateId: v.optional(v.id("applicationTemplates")),
    title: v.string(),
    version: v.optional(v.string()),
    applicationType: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    product: v.optional(v.string()),
    status: v.optional(templateStatusValidator),
    sourceKind: v.union(
      v.literal("manual"),
      v.literal("pdf"),
      v.literal("imported"),
      v.literal("generated"),
    ),
    sourceFileId: v.optional(v.id("_storage")),
    questionGraph: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    assertBrokerOrg(access);
    const now = nowMs();
    const questionGraph = toJsonValue(args.questionGraph);
    const parsedGraph = parseQuestionGraph(questionGraph);
    const fieldCount = parsedGraph ? flattenQuestionGraph(parsedGraph).length : 0;
    if (args.templateId) {
      const existing = await ctx.db.get(args.templateId);
      if (!existing || existing.brokerOrgId !== access.orgId) {
        throw new Error("Application template not found");
      }
      await ctx.db.patch(args.templateId, {
        title: args.title,
        version: args.version ?? existing.version,
        applicationType: args.applicationType,
        lineOfBusiness: args.lineOfBusiness,
        product: args.product,
        status: args.status ?? existing.status,
        sourceKind: args.sourceKind,
        sourceFileId: args.sourceFileId,
        questionGraph,
        fieldCount,
        updatedAt: now,
      });
      return await ctx.db.get(args.templateId);
    }

    const templateId = await ctx.db.insert("applicationTemplates", {
      brokerOrgId: access.orgId,
      title: args.title,
      version: args.version ?? dayjs(now).format("YYYY.MM.DD-HHmmss"),
      applicationType: args.applicationType,
      lineOfBusiness: args.lineOfBusiness,
      product: args.product,
      status: args.status ?? "draft",
      sourceKind: args.sourceKind,
      sourceFileId: args.sourceFileId,
      questionGraph,
      fieldCount,
      createdByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(templateId);
  },
});

export const listForBroker = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("collecting"),
        v.literal("waiting_on_client"),
        v.literal("needs_broker_review"),
        v.literal("broker_ready"),
        v.literal("submitted"),
        v.literal("cancelled"),
        v.literal("stale"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    assertBrokerOrg(access);
    const rows = args.status
      ? await ctx.db
          .query("applicationIntakes")
          .withIndex("by_brokerOrgId_status", (q) =>
            q.eq("brokerOrgId", access.orgId).eq("status", args.status!),
          )
          .order("desc")
          .take(100)
      : await ctx.db
          .query("applicationIntakes")
          .withIndex("by_brokerOrgId_updatedAt", (q) =>
            q.eq("brokerOrgId", access.orgId),
          )
          .order("desc")
          .take(100);
    return await attachClientNames(ctx, rows);
  },
});

export const listForClient = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { access } = await getWritableApplicationAccess(ctx, args.orgId);
    const rows = await ctx.db
      .query("applicationIntakes")
      .withIndex("by_orgId_updatedAt", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(100);
    return await attachClientNames(ctx, rows, access.org);
  },
});

export const get = query({
  args: { applicationIntakeId: v.id("applicationIntakes") },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) return null;
    await getWritableApplicationAccess(ctx, intake.orgId);
    const [packets, clientOrg] = await Promise.all([
      ctx.db
        .query("applicationPackets")
        .withIndex("by_applicationIntakeId", (q) =>
          q.eq("applicationIntakeId", intake._id),
        )
        .order("desc")
        .take(10),
      ctx.db.get(intake.orgId),
    ]);
    const packetsWithFiles = await Promise.all(
      packets.map(async (packet) => ({
        ...packet,
        fileUrl: packet.fileId ? await ctx.storage.getUrl(packet.fileId) : null,
      })),
    );
    return {
      ...intake,
      clientName: clientOrg?.name,
      clientWebsite: clientOrg?.website,
      clientIconUrl: clientOrg?.iconStorageId
        ? await ctx.storage.getUrl(clientOrg.iconStorageId)
        : null,
      packets: packetsWithFiles,
    };
  },
});

export const generateUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getWritableApplicationAccess(ctx, args.orgId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const assertQuestionAuthoringAccess = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getWritableApplicationAccess(ctx, args.orgId);
    return null;
  },
});

export const start = mutation({
  args: {
    orgId: v.id("organizations"),
    templateId: v.optional(v.id("applicationTemplates")),
    sourceKind: sourceKindValidator,
    requestText: v.optional(v.string()),
    title: v.optional(v.string()),
    applicationType: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    product: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    questionGraph: v.optional(v.any()),
    missingQuestions: v.optional(v.array(missingQuestionValidator)),
  },
  handler: async (ctx, args) => {
    const { access, brokerOrgId } = await getWritableApplicationAccess(ctx, args.orgId);
    return await startIntake(ctx, {
      ...args,
      userId: access.userId,
      brokerOrgId,
    });
  },
});

export const recordAnswers = mutation({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
    answers: v.array(answerValidator),
    sourceKind: sourceKindValidator,
    message: v.optional(v.string()),
    threadMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) throw new Error("Application intake not found");
    const { access } = await getWritableApplicationAccess(ctx, intake.orgId);
    return await recordAnswersForIntake(ctx, {
      ...args,
      userId: access.userId,
      intake,
    });
  },
});

export const preparePacket = mutation({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
    submissionNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) throw new Error("Application intake not found");
    const { access } = await getWritableApplicationAccess(ctx, intake.orgId);
    return await preparePacketForIntake(ctx, {
      intake,
      userId: access.userId,
      submissionNotes: args.submissionNotes,
    });
  },
});

export const markSubmitted = mutation({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) throw new Error("Application intake not found");
    const { access } = await getWritableApplicationAccess(ctx, intake.orgId);
    if (access.accessType !== "broker_of_client" && access.orgType !== "broker") {
      throw new Error("Only brokers can mark applications submitted");
    }
    const now = nowMs();
    await ctx.db.patch(intake._id, {
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    if (intake.packetId) {
      await ctx.db.patch(intake.packetId, {
        status: "submitted",
        submittedAt: now,
        updatedAt: now,
      });
    }
    return await ctx.db.get(intake._id);
  },
});

export const applyContextProposal = mutation({
  args: {
    proposalId: v.id("applicationContextProposals"),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Context proposal not found");
    await getWritableApplicationAccess(ctx, proposal.orgId);
    const now = nowMs();
    await ctx.db.insert("orgMemory", {
      orgId: proposal.orgId,
      type: "fact",
      content: `${proposal.key}: ${proposal.value}`,
      source: "analysis",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(proposal._id, {
      status: "applied",
      appliedAt: now,
    });
    return { status: "applied" as const };
  },
});

export const startFromAgent = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    templateId: v.optional(v.id("applicationTemplates")),
    sourceKind: sourceKindValidator,
    requestText: v.optional(v.string()),
    title: v.optional(v.string()),
    applicationType: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    product: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    questionGraph: v.optional(v.any()),
    missingQuestions: v.optional(v.array(missingQuestionValidator)),
  },
  handler: async (ctx, args) => {
    const access = await getWritableApplicationAccessForUser(ctx, args.userId, args.orgId);
    return await startIntake(ctx, {
      ...args,
      brokerOrgId: access.brokerOrgId,
    });
  },
});

export const getForAgent = internalQuery({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) return null;
    await getWritableApplicationAccessForUser(ctx, args.userId, intake.orgId);
    return intake;
  },
});

export const listForAgent = internalQuery({
  args: {
    orgIds: v.array(v.id("organizations")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const rows = [];
    for (const orgId of args.orgIds.slice(0, 20)) {
      await getWritableApplicationAccessForUser(ctx, args.userId, orgId);
      const orgRows = await ctx.db
        .query("applicationIntakes")
        .withIndex("by_orgId_updatedAt", (q) => q.eq("orgId", orgId))
        .order("desc")
        .take(10);
      rows.push(...orgRows);
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice(0, 20);
  },
});

export const recordAnswersFromAgent = internalMutation({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
    userId: v.id("users"),
    answers: v.array(answerValidator),
    sourceKind: sourceKindValidator,
    message: v.optional(v.string()),
    threadMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) throw new Error("Application intake not found");
    await getWritableApplicationAccessForUser(ctx, args.userId, intake.orgId);
    return await recordAnswersForIntake(ctx, { ...args, intake });
  },
});

export const preparePacketFromAgent = internalMutation({
  args: {
    applicationIntakeId: v.id("applicationIntakes"),
    userId: v.id("users"),
    submissionNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.applicationIntakeId);
    if (!intake) throw new Error("Application intake not found");
    await getWritableApplicationAccessForUser(ctx, args.userId, intake.orgId);
    return await preparePacketForIntake(ctx, {
      intake,
      userId: args.userId,
      submissionNotes: args.submissionNotes,
    });
  },
});

async function recordAnswersForIntake(
  ctx: MutationCtx,
  args: {
    intake: Doc<"applicationIntakes">;
    userId: Id<"users">;
    answers: Array<{
      fieldId: string;
      label: string;
      section?: string;
      value: string;
      source?: string;
      sourceSpanIds?: string[];
      userSourceSpanIds?: string[];
    }>;
    sourceKind: "web" | "email" | "imessage" | "mcp" | "broker_portal" | "operator";
    message?: string;
    threadMessageId?: Id<"threadMessages">;
  },
) {
  const now = nowMs();
  const state = buildStateForIntake(args.intake);
  const nextState = applySdkApplicationAnswers(
    state,
    args.answers.map((answer) => ({
      fieldId: answer.fieldId,
      value: answer.value,
      source: answer.source,
      confidence: "confirmed",
      sourceSpanIds: answer.sourceSpanIds,
      userSourceSpanIds: answer.userSourceSpanIds,
    })),
    now,
  );
  const normalizedAnswers = answerRowsFromState(nextState, now, args.intake.normalizedAnswers);
  const missingQuestions = missingQuestionsFromState(nextState);
  const status = "collecting";
  const contextProposals = contextProposalsForAnswers(nextState, args.answers);

  await ctx.db.patch(args.intake._id, {
    normalizedAnswers,
    missingQuestions,
    status,
    packetId: undefined,
    updatedAt: now,
    lastActivityAt: now,
  });

  if (args.message?.trim()) {
    await ctx.db.insert("applicationMessages", {
      applicationIntakeId: args.intake._id,
      orgId: args.intake.orgId,
      brokerOrgId: args.intake.brokerOrgId,
      sourceKind: args.sourceKind,
      role: "user",
      content: args.message.trim(),
      threadMessageId: args.threadMessageId,
      createdByUserId: args.userId,
      createdAt: now,
    });
  }

  for (const proposal of contextProposals) {
    await ctx.db.insert("applicationContextProposals", {
      applicationIntakeId: args.intake._id,
      orgId: args.intake.orgId,
      fieldId: proposal.fieldId,
      key: proposal.key,
      value: proposal.value,
      category: proposal.category,
      source: proposal.source,
      confidence: proposal.confidence,
      status: "pending",
      sourceSpanIds: proposal.sourceSpanIds,
      userSourceSpanIds: proposal.userSourceSpanIds,
      createdAt: now,
    });
  }

  await ctx.db.patch(args.intake._id, {
    contextProposalCount: args.intake.contextProposalCount + contextProposals.length,
  });

  await recordBrokerActivity(ctx, {
    brokerOrgId: args.intake.brokerOrgId,
    clientOrgId: args.intake.orgId,
    userId: args.userId,
    type: "application_batch_submitted",
    summary: `${args.answers.length} application answer${args.answers.length === 1 ? "" : "s"} received`,
    payload: { applicationIntakeId: args.intake._id, answerCount: args.answers.length },
    now,
  });

  return await ctx.db.get(args.intake._id);
}

async function preparePacketForIntake(
  ctx: MutationCtx,
  args: {
    intake: Doc<"applicationIntakes">;
    userId: Id<"users">;
    submissionNotes?: string;
  },
) {
  const now = nowMs();
  const packet = buildSdkApplicationPacket(buildStateForIntake(args.intake), {
    submissionNotes: args.submissionNotes,
    now,
  });
  const qualityReport = validateSdkApplicationPacket(packet);
  const packetId = await ctx.db.insert("applicationPackets", {
    applicationIntakeId: args.intake._id,
    orgId: args.intake.orgId,
    brokerOrgId: args.intake.brokerOrgId,
    status: packet.status,
    missingFieldIds: packet.missingFieldIds,
    qualityReport,
    submissionNotes: args.submissionNotes,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(args.intake._id, {
    packetId,
    status: packet.status === "broker_ready" ? "broker_ready" : "needs_broker_review",
    updatedAt: now,
    lastActivityAt: now,
  });

  await recordBrokerActivity(ctx, {
    brokerOrgId: args.intake.brokerOrgId,
    clientOrgId: args.intake.orgId,
    userId: args.userId,
    type: "application_completed",
    summary: packet.status === "broker_ready"
      ? "Application ready for broker review"
      : "Application submitted with missing required fields",
    payload: { applicationIntakeId: args.intake._id, packetId },
    now,
  });

  if (packet.status === "broker_ready") {
    await notifyBroker(ctx, {
      brokerOrgId: args.intake.brokerOrgId,
      clientOrgId: args.intake.orgId,
      intakeId: args.intake._id,
      type: "application_packet_ready",
      title: "Application ready for review",
      body: args.intake.title,
      now,
    });
  }

  return await ctx.db.get(packetId);
}

async function attachClientNames(
  ctx: QueryCtx,
  rows: Doc<"applicationIntakes">[],
  knownOrg?: Pick<Doc<"organizations">, "name" | "website" | "iconStorageId">,
) {
  return await Promise.all(
    rows.map(async (row) => {
      const org = knownOrg ?? await ctx.db.get(row.orgId);
      return {
        ...row,
        clientName: org?.name ?? "Client",
        clientWebsite: org?.website,
        clientIconUrl: org?.iconStorageId
          ? await ctx.storage.getUrl(org.iconStorageId)
          : null,
      };
    }),
  );
}
