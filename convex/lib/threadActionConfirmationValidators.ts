import { v } from "convex/values";

export const threadActionActorValidator = v.object({
  kind: v.union(
    v.literal("user"),
    v.literal("email"),
    v.literal("imessage"),
    v.literal("slack"),
  ),
  userId: v.optional(v.id("users")),
  address: v.optional(v.string()),
  slackActorId: v.optional(v.id("slackActors")),
});

const requirementClassificationValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  documentClass: v.union(
    v.literal("insurance_requirements"),
    v.literal("mixed"),
    v.literal("not_requirements"),
  ),
  confidence: v.number(),
});

export const threadActionConfirmationPayloadValidator = v.union(
  v.object({
    kind: v.literal("draft_snapshot"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("email_send"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("email_cancel"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("coi_batch_delivery"),
    pendingEmailId: v.id("pendingEmails"),
    recipientEmail: v.string(),
    fileIds: v.array(v.id("_storage")),
    draftFingerprint: v.string(),
  }),
  v.object({
    kind: v.literal("requirement_import"),
    fileIds: v.array(v.id("_storage")),
    classifications: v.array(requirementClassificationValidator),
    scope: v.union(v.literal("vendors"), v.literal("own_org")),
    confidence: v.number(),
    intentEvidence: v.string(),
  }),
);

export const threadActionConfirmationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("stale"),
  v.literal("expired"),
);
