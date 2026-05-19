"use node";

import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import dayjs from "dayjs";
import { getModelForOrg, getProviderOptionsForTask } from "./models";
import { sendResendEmail, getAgentDomain } from "./resend";
import { markdownToHtml, stripMarkdown } from "./aiUtils";
import { isWhiteLabelingEnabled } from "./branding";
import { COI_GENERATION_FAILED_MESSAGE } from "./actionFailures";
import { buildGlassEmailIconHtml } from "./emailTemplate";
import { getClientPortalUrl } from "./domains";
import {
  extractEmailAddress,
  normalizeEmailAddress,
} from "./emailAddress";
import {
  isCoiAttachmentFilename,
  normalizeAttachmentText,
  resolveRequestedCoiAttachmentsForRecipient,
  shouldSuppressOriginalPolicyForCoiRequest,
  type RequestedEmailAttachment,
} from "./coiAttachmentGuards";
import {
  buildCertificateProgramSelection,
  formatCertificateProgramSelectionForUser,
  normalizeSelectedPartnerProgramId,
} from "./certificateProgramSelection";

const MAX_EMAIL_SIZE = 38 * 1024 * 1024; // Resend limit is 40MB after Base64 encoding.
const GLASS_PUBLIC_URL = getClientPortalUrl();

export type EmailAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  fileId: Id<"_storage">;
};

export type EmailSubagentResult = {
  status: "draft" | "needs_confirmation" | "pending" | "sent" | "error";
  responseBody: string;
  confirmationReason?: string;
  responseTo?: string;
  responseCc?: string[];
  responseBcc?: string[];
  subject?: string;
  emailBody?: string;
  responseMessageId?: string;
  pendingEmailId?: Id<"pendingEmails">;
  attachments?: EmailAttachmentMeta[];
  allowMultipleCoiAttachments?: boolean;
};

export type BrokerBranding = {
  name?: string;
  logoUrl?: string | null;
  agentDisplayName?: string | null;
};

type EmailExpertContext = {
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  chatMessageId?: Id<"threadMessages">;
  channel: "web" | "email" | "imessage" | "mcp";
  fromHeader: string;
  agentAddress: string;
  brokerBranding?: BrokerBranding;
  senderEmail?: string;
  defaultTo?: string;
  defaultRecipientName?: string;
  defaultCc?: string[];
  defaultBcc?: string[];
  subjectHint?: string;
  inReplyTo?: string;
  references?: string;
  allowedRecipients?: string[];
  availableAttachments?: EmailAttachmentMeta[];
  referencedPolicyIds?: Id<"policies">[];
  referencedQuoteIds?: Id<"policies">[];
  autoSendEmails?: boolean;
  emailSendDelay?: number;
  autoGenerateCoi?: boolean;
  coiHandling?: "broker" | "member" | "ignore";
  conversationContext?: string;
  onResult?: (result: EmailSubagentResult) => void;
};

export function getEmailAgentFromName(broker?: BrokerBranding): string {
  if (broker?.name || broker?.agentDisplayName) {
    const base = broker.agentDisplayName || broker.name;
    return `${base} Agent`;
  }
  return "Glass from Clarity Labs";
}

export function buildEmailSignature(agentEmail: string, broker?: BrokerBranding): { text: string; html: string } {
  const poweredByUrl = GLASS_PUBLIC_URL;
  const hasBroker = !!(broker?.name || broker?.agentDisplayName);
  const agentName = getEmailAgentFromName(broker);

  const text = [
    "",
    "-",
    agentName,
    agentEmail,
    ...(hasBroker ? ["", `powered by Glass from Clarity Labs - ${poweredByUrl}`] : []),
  ].join("\n");

  const logoHtml = hasBroker && broker?.logoUrl
    ? `<img src="${broker.logoUrl}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:4px;margin-right:8px;object-fit:cover;border:0;" />`
    : buildGlassEmailIconHtml({ size: 20, borderRadius: 4, margin: "0 8px 0 0" });

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">-</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${agentName}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    ...(hasBroker
      ? [`<p style="font-size:12px;margin:6px 0 0"><a href="${poweredByUrl}" style="color:#A0D2FA;text-decoration:none">powered by Glass from Clarity Labs</a></p>`]
      : []),
  ].join("\n");

  return { text, html };
}

export async function resolveEmailAgentIdentity(
  ctx: ActionCtx,
  org: Record<string, unknown>,
): Promise<{
  canSend: boolean;
  agentAddress?: string;
  fromHeader?: string;
  brokerBranding?: BrokerBranding;
  reason?: string;
}> {
  let sendingOrg = org;
  if (org.type === "client" && org.brokerOrgId) {
    const brokerOrg = await ctx.runQuery(internal.orgs.getInternal, {
      id: org.brokerOrgId as Id<"organizations">,
    });
    if (brokerOrg) sendingOrg = brokerOrg;
  }

  const handle = typeof sendingOrg.agentHandle === "string" && sendingOrg.agentHandle.trim()
    ? sendingOrg.agentHandle
    : "agent";

  const whiteLabelingEnabled = isWhiteLabelingEnabled(
    sendingOrg as { whiteLabelingEnabled?: boolean },
  );
  const logoUrl = whiteLabelingEnabled && sendingOrg.iconStorageId
    ? await ctx.storage.getUrl(sendingOrg.iconStorageId as Id<"_storage">)
    : null;
  const brokerBranding: BrokerBranding | undefined = whiteLabelingEnabled
    ? {
        name: typeof sendingOrg.name === "string" ? sendingOrg.name : undefined,
        logoUrl,
        agentDisplayName: typeof sendingOrg.agentDisplayName === "string"
          ? sendingOrg.agentDisplayName
          : undefined,
      }
    : undefined;

  const agentAddress = `${handle}@${getAgentDomain()}`;
  return {
    canSend: true,
    agentAddress,
    fromHeader: `${getEmailAgentFromName(brokerBranding)} <${agentAddress}>`,
    brokerBranding,
  };
}

function formatDraft(params: {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachments?: EmailAttachmentMeta[];
  reason?: string;
}): string {
  const attachmentLine = params.attachments?.length
    ? `\nAttachments: ${params.attachments.map((a) => a.filename).join(", ")}`
    : "";
  const reasonLine = params.reason ? `${params.reason}\n\n` : "";
  return [
    `${reasonLine}Draft email${params.to ? ` to ${params.to}` : ""}:`,
    "",
    `To: ${params.to ?? "[confirm recipient]"}`,
    params.cc?.length ? `Cc: ${params.cc.join(", ")}` : null,
    params.bcc?.length ? `Bcc: ${params.bcc.join(", ")}` : null,
    `Subject: ${params.subject ?? "[confirm subject]"}`,
    attachmentLine.trim() ? attachmentLine.trim() : null,
    "",
    params.body ?? "[confirm body]",
    "",
    "Ready to send?",
  ].filter((line) => line !== null).join("\n");
}

function buildHtmlBody(body: string, signature: { html: string }): string {
  return body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`)
    .join("\n") + signature.html;
}

export function buildEmailPayload(params: {
  fromHeader: string;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  signature: { text: string; html: string };
  inReplyTo?: string;
  references?: string;
}) {
  const plainText = stripMarkdown(params.body) + params.signature.text;
  const html = buildHtmlBody(params.body, { html: params.signature.html });
  const payload: Record<string, unknown> = {
    from: params.fromHeader,
    to: params.to,
    subject: params.subject,
    text: plainText,
    html,
  };
  if (params.cc.length > 0) payload.cc = params.cc;
  if (params.bcc.length > 0) payload.bcc = params.bcc;
  const headers: Record<string, string> = {};
  if (params.inReplyTo) headers["In-Reply-To"] = params.inReplyTo;
  if (params.references ?? params.inReplyTo) {
    headers.References = params.references ?? params.inReplyTo!;
  }
  if (Object.keys(headers).length > 0) payload.headers = headers;
  return payload;
}

export async function upsertEmailDraftArtifact(
  ctx: ActionCtx,
  context: EmailExpertContext,
  params: {
    to: string;
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    attachments: EmailAttachmentMeta[];
    allowMultipleCoiAttachments?: boolean;
    referencedPolicyIds?: Id<"policies">[];
    referencedQuoteIds?: Id<"policies">[];
  },
): Promise<Id<"pendingEmails"> | undefined> {
  if (!["web", "mcp"].includes(context.channel) || !context.threadId) return undefined;

  const signature = buildEmailSignature(context.agentAddress, context.brokerBranding);
  const emailPayload = buildEmailPayload({
    fromHeader: context.fromHeader,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    signature,
    inReplyTo: context.inReplyTo,
    references: context.references,
  });

  const existing = await ctx.runQuery(internal.pendingEmails.findDraftByThreadAndRecipient, {
    threadId: context.threadId,
    recipientEmail: params.to,
  });

  if (existing) {
    await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
      id: existing._id,
      emailPayload: JSON.stringify(emailPayload),
      recipientEmail: params.to,
      ccAddresses: params.cc.length > 0 ? params.cc : undefined,
      bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      emailBody: params.body,
      attachments: params.attachments.length > 0 ? params.attachments : undefined,
      allowMultipleCoiAttachments: params.allowMultipleCoiAttachments,
      referencedPolicyIds: params.referencedPolicyIds,
      referencedQuoteIds: params.referencedQuoteIds,
      chatMessageId: context.chatMessageId,
    });
    if (existing.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: existing.threadMessageId,
        content: params.body,
        toAddresses: [params.to],
        ccAddresses: params.cc.length > 0 ? params.cc : undefined,
        bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
        subject: params.subject,
        attachments: params.attachments.length > 0 ? params.attachments : undefined,
        referencedPolicyIds: params.referencedPolicyIds,
        referencedQuoteIds: params.referencedQuoteIds,
        pendingEmailId: existing._id,
        status: "draft_email",
      });
    }
    if (context.chatMessageId) {
      await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
        id: context.chatMessageId,
        pendingEmailId: existing._id,
      });
    }
    return existing._id;
  }

  const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
    orgId: context.orgId,
    threadId: context.threadId,
    emailPayload: JSON.stringify(emailPayload),
    scheduledSendTime: 0,
    chatMessageId: context.chatMessageId,
    recipientEmail: params.to,
    ccAddresses: params.cc.length > 0 ? params.cc : undefined,
    bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
    subject: params.subject,
    emailBody: params.body,
    attachments: params.attachments.length > 0 ? params.attachments : undefined,
    allowMultipleCoiAttachments: params.allowMultipleCoiAttachments,
    referencedPolicyIds: params.referencedPolicyIds,
    referencedQuoteIds: params.referencedQuoteIds,
    status: "draft",
  });
  const draftMessageId = await ctx.runMutation(internal.threads.insertEmailMessage, {
    threadId: context.threadId,
    orgId: context.orgId,
    role: "agent",
    fromEmail: context.agentAddress,
    fromName: getEmailAgentFromName(context.brokerBranding),
    content: params.body,
    toAddresses: [params.to],
    ccAddresses: params.cc.length > 0 ? params.cc : undefined,
    bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
    subject: params.subject,
    attachments: params.attachments.length > 0 ? params.attachments : undefined,
    referencedPolicyIds: params.referencedPolicyIds,
    referencedQuoteIds: params.referencedQuoteIds,
    status: "draft_email",
    pendingEmailId,
  });
  await ctx.runMutation(internal.pendingEmails.setThreadMessage, {
    id: pendingEmailId,
    threadMessageId: draftMessageId,
  });
  if (context.chatMessageId) {
    await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
      id: context.chatMessageId,
      pendingEmailId,
    });
  }

  return pendingEmailId;
}

export async function toResendAttachments(
  ctx: ActionCtx,
  attachments: EmailAttachmentMeta[],
): Promise<Array<{ filename: string; content: string }>> {
  let encodedSize = 0;
  const result: Array<{ filename: string; content: string }> = [];

  for (const att of attachments) {
    const blob = await ctx.storage.get(att.fileId);
    if (!blob) throw new Error(`Attachment "${att.filename}" is no longer available.`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const content = buffer.toString("base64");
    encodedSize += Buffer.byteLength(content, "utf8");
    if (encodedSize > MAX_EMAIL_SIZE) {
      throw new Error("Attachments are too large to send in one email.");
    }
    result.push({ filename: att.filename, content });
  }

  return result;
}

function uniqueAttachments(attachments: EmailAttachmentMeta[]): EmailAttachmentMeta[] {
  const seen = new Set<string>();
  const result: EmailAttachmentMeta[] = [];
  for (const att of attachments) {
    const key = `${att.fileId}:${att.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(att);
  }
  return result;
}

export function buildEmailExpertTool(
  ctx: ActionCtx,
  params: EmailExpertContext,
) {
  return tool({
    description:
      "Delegate email drafting, formatting, attachment selection, and validated sending to the Glass email expert. Use this whenever the user asks to draft, send, forward, or attach documents to an email.",
    inputSchema: z.object({
      request: z.string().describe("The user's full email request and any relevant context."),
      to: z.string().optional().describe("Recipient email address if known."),
      recipientName: z.string().optional().describe("Recipient name if known."),
      subject: z.string().optional().describe("Subject line if the user supplied or approved one."),
      body: z.string().optional().describe("Email body if already drafted or approved."),
      cc: z.array(z.string()).optional().describe("CC email addresses."),
      bcc: z.array(z.string()).optional().describe("BCC email addresses."),
      approvedToSend: z.boolean().optional().describe("True only when the user explicitly approved sending this exact email."),
      attachments: z.array(z.object({
        kind: z.enum(["original_policy", "coi", "uploaded_file"]),
        policyId: z.string().optional(),
        fileId: z.string().optional(),
        filename: z.string().optional(),
        certificateHolder: z.string().optional(),
      })).optional().describe(
        "Documents the user explicitly asked to attach. For certificate/COI requests, use kind 'coi' only; do not include original_policy unless the user separately asked for the original/full policy PDF.",
      ),
    }),
    execute: async (input): Promise<EmailSubagentResult> => {
      const result = await runEmailSubagent(ctx, params, input);
      params.onResult?.(result);
      return result;
    },
  });
}

async function runEmailSubagent(
  ctx: ActionCtx,
  context: EmailExpertContext,
  input: {
    request: string;
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    approvedToSend?: boolean;
    attachments?: RequestedEmailAttachment[];
  },
): Promise<EmailSubagentResult> {
  const preparedAttachments: EmailAttachmentMeta[] = [];
  const safeRequestedAttachments = resolveRequestedCoiAttachmentsForRecipient({
    request: input.request,
    to: input.to,
    recipientName: input.recipientName,
    defaultTo: context.defaultTo,
    defaultRecipientName: context.defaultRecipientName,
    attachments: input.attachments,
  });
  const { allowMultipleCoiAttachments } = safeRequestedAttachments;
  const sourcePolicyIds = new Set((context.referencedPolicyIds ?? []).map(String));
  const suppressOriginalPolicyForCoiRequest = shouldSuppressOriginalPolicyForCoiRequest(input.request);
  const savedThreadAttachments = context.threadId
    ? await ctx.runQuery(internal.threads.listThreadAttachmentsInternal, {
        threadId: context.threadId,
        orgId: context.orgId,
        excludeEmailArtifacts: true,
        excludeAgentCoiAttachments: suppressOriginalPolicyForCoiRequest,
      }) as EmailAttachmentMeta[]
    : [];
  const availableAttachments = uniqueAttachments([
    ...(context.availableAttachments ?? []),
    ...savedThreadAttachments,
  ]);
  const allowedAttachmentIds = new Set(
    availableAttachments.map((att) => String(att.fileId)),
  );
  const attachedOriginalPolicyIds = new Set<string>();
  const attachedUploadedFileIds = new Set<string>();
  const attachedCoiKeys = new Set<string>();
  const generatedCoiAttachmentIds = new Set<string>();

  const addAttachment = (attachment: EmailAttachmentMeta) => {
    preparedAttachments.push(attachment);
  };

  const attachOriginalPolicy = async (policyId: string): Promise<string> => {
    sourcePolicyIds.add(policyId);
    if (suppressOriginalPolicyForCoiRequest) {
      return "Skipped original policy attachment because this request only asks for the generated COI.";
    }
    if (attachedOriginalPolicyIds.has(policyId)) {
      return "Original policy is already attached.";
    }
    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: policyId as Id<"policies">,
    });
    if (!policy || policy.orgId !== context.orgId) return "Policy not found.";
    if (!policy.fileId) return "That policy does not have an original file available.";
    attachedOriginalPolicyIds.add(policyId);
    addAttachment({
      filename: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
      contentType: "application/pdf",
      size: 0,
      fileId: policy.fileId as Id<"_storage">,
    });
    return `Attached original policy document: ${policy.fileName ?? policy.policyNumber ?? policy._id}`;
  };

  const attachUploadedFile = (fileId: string, filename?: string): string => {
    if (!allowedAttachmentIds.has(fileId)) {
      return "That uploaded file is not available in this conversation.";
    }
    if (attachedUploadedFileIds.has(fileId)) {
      return "Uploaded file is already attached.";
    }
    const found = availableAttachments.find((att) => String(att.fileId) === fileId);
    if (!found) return "Uploaded file not found.";
    if (
      suppressOriginalPolicyForCoiRequest &&
      !isCoiAttachmentFilename(found.filename)
    ) {
      return "Skipped uploaded file because COI delivery requests should attach only the generated COI.";
    }
    attachedUploadedFileIds.add(fileId);
    addAttachment({ ...found, filename: filename ?? found.filename });
    return `Attached uploaded file: ${filename ?? found.filename}`;
  };

  const generateCoiAttachment = async (
    policyId: string,
    certificateHolder?: string,
    partnerProgramId?: string,
  ): Promise<string> => {
    sourcePolicyIds.add(policyId);
    const coiKey = `${policyId}:${normalizeAttachmentText(certificateHolder)}`;
    if (attachedCoiKeys.has(coiKey)) {
      return "Generated COI is already attached.";
    }
    if (context.autoGenerateCoi === false) {
      if (context.coiHandling === "broker") return "COI auto-generation is off. Contact the broker before attaching a COI.";
      if (context.coiHandling === "member") return "COI auto-generation is off. Confirm the org's insurance contact should handle this COI.";
      return "COI auto-generation is disabled.";
    }
    let generated: any;
    try {
      generated = await ctx.runAction(internal.certificates.generateForOrg, {
        policyId: policyId as Id<"policies">,
        orgId: context.orgId,
        holderName: certificateHolder?.split(/\r?\n/)[0]?.trim() || "Certificate holder",
        certificateHolder,
        selectedPartnerProgramId: normalizeSelectedPartnerProgramId(partnerProgramId),
        source: context.channel === "web" ? "chat" : context.channel,
      });
    } catch (err) {
      console.error("[emailSubagent] COI generation failed:", err);
      return COI_GENERATION_FAILED_MESSAGE;
    }
    if (!generated) return COI_GENERATION_FAILED_MESSAGE;
    if (generated.status === "pending_approval") {
      return "Certified COI approval has been requested from the program administrator; no certificate PDF is attached yet.";
    }
    if (generated.status === "needs_program_selection") {
      const selection = buildCertificateProgramSelection({
        policyId,
        holderName:
          certificateHolder?.split(/\r?\n/)[0]?.trim() ||
          "Certificate holder",
        certificateHolder,
        candidates: generated.matchCandidates,
        source: context.channel === "imessage" ? "imessage" : "agent",
      });
      return selection
        ? formatCertificateProgramSelectionForUser(selection)
        : "I found multiple possible program administrator programs. Choose the correct program before I attach the certified COI.";
    }
    attachedCoiKeys.add(coiKey);
    addAttachment({
      filename: generated.fileName,
      contentType: "application/pdf",
      size: generated.size,
      fileId: generated.fileId as Id<"_storage">,
    });
    generatedCoiAttachmentIds.add(String(generated.fileId));
    return generated.authorityType === "certified"
      ? "Attached certified COI."
      : "Attached non-binding COI.";
  };

  if (safeRequestedAttachments.warning && safeRequestedAttachments.attachments.length === 0) {
    return {
      status: "needs_confirmation",
      responseBody: safeRequestedAttachments.warning,
      confirmationReason: safeRequestedAttachments.warning,
    };
  }

  for (const requested of safeRequestedAttachments.attachments) {
    if (requested.kind === "original_policy" && requested.policyId) {
      await attachOriginalPolicy(requested.policyId);
    } else if (requested.kind === "coi" && requested.policyId) {
      await generateCoiAttachment(requested.policyId, requested.certificateHolder);
    } else if (requested.kind === "uploaded_file" && requested.fileId) {
      attachUploadedFile(requested.fileId, requested.filename);
    }
  }

  let finalResult: EmailSubagentResult | null = null;
  const policies = await ctx.runQuery(internal.policies.listAllInternal, {
    orgId: context.orgId,
  });
  const availablePolicies = (policies as Doc<"policies">[]).slice(0, 25).map((policy) => ({
    id: policy._id,
    insured: policy.insuredName,
    carrier: policy.security ?? policy.carrier,
    type: policy.policyTypes?.join(", "),
    number: policy.policyNumber,
    fileName: policy.fileName,
    hasOriginalFile: !!policy.fileId,
  }));

  const allowedRecipients = (context.allowedRecipients ?? [])
    .map(normalizeEmailAddress)
    .filter(Boolean);
  const defaultCc = [...new Set([...(context.defaultCc ?? []), ...(input.cc ?? [])].filter(Boolean))];
  const defaultBcc = [...new Set([...(context.defaultBcc ?? []), ...(input.bcc ?? [])].filter(Boolean))];

  const sendOrDraftEmail = async (params: {
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    approvedToSend?: boolean;
  }): Promise<EmailSubagentResult> => {
    const to = extractEmailAddress(params.to) ?? extractEmailAddress(input.to) ?? extractEmailAddress(context.defaultTo);
    const subject = (params.subject ?? input.subject ?? context.subjectHint ?? "").trim();
    const body = (params.body ?? input.body ?? "").trim();
    const cc = [...new Set([...(params.cc ?? []), ...defaultCc].map(normalizeEmailAddress).filter((email) => email && email !== to))];
    const bcc = [...new Set([...(params.bcc ?? []), ...defaultBcc].map(normalizeEmailAddress).filter((email) => email && email !== to && !cc.includes(email)))];
    const attachments = uniqueAttachments(preparedAttachments).filter((attachment) => {
      if (!suppressOriginalPolicyForCoiRequest || generatedCoiAttachmentIds.size === 0) {
        return true;
      }
      return generatedCoiAttachmentIds.has(String(attachment.fileId));
    });
    const approvedToSend = params.approvedToSend === true || input.approvedToSend === true;
    const autoSend = context.autoSendEmails === true;

    const uncertainty: string[] = [];
    if (!to) uncertainty.push("Confirm the recipient email address.");
    if (!subject) uncertainty.push("Confirm the subject line.");
    if (!body) uncertainty.push("Confirm the email body.");
    const unknownRecipients = [to, ...cc, ...bcc]
      .filter((email): email is string => !!email)
      .filter((email) => allowedRecipients.length > 0 && !allowedRecipients.includes(email));
    if (unknownRecipients.length > 0 && !approvedToSend) {
      uncertainty.push(`Confirm that ${unknownRecipients.join(", ")} ${unknownRecipients.length === 1 ? "is" : "are"} the intended recipient${unknownRecipients.length === 1 ? "" : "s"}.`);
    }

    if (uncertainty.length > 0 || (!autoSend && !approvedToSend)) {
      const status = uncertainty.length > 0 ? "needs_confirmation" : "draft";
      const referencedPolicyIds = sourcePolicyIds.size > 0
        ? ([...sourcePolicyIds] as Id<"policies">[])
        : undefined;
      const draftPendingEmailId = to && subject && body
        ? await upsertEmailDraftArtifact(ctx, context, {
            to,
            cc,
            bcc,
            subject,
            body,
            attachments,
            allowMultipleCoiAttachments,
            referencedPolicyIds,
            referencedQuoteIds: context.referencedQuoteIds,
          })
        : undefined;
      finalResult = {
        status,
        responseBody: formatDraft({
          to: to ?? undefined,
          cc,
          bcc,
          subject,
          body,
          attachments,
          reason: uncertainty.length > 0 ? uncertainty.join(" ") : undefined,
        }),
        confirmationReason: uncertainty.length > 0
          ? uncertainty.join(" ")
          : "Ready to send?",
        responseTo: to ?? undefined,
        responseCc: cc.length > 0 ? cc : undefined,
        responseBcc: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        pendingEmailId: draftPendingEmailId,
        attachments,
        allowMultipleCoiAttachments,
      };
      return finalResult;
    }

    if (!to) throw new Error("Recipient email is required before sending.");
    const sendTo = to;
    const signature = buildEmailSignature(context.agentAddress, context.brokerBranding);
    const emailPayload = buildEmailPayload({
      fromHeader: context.fromHeader,
      to: sendTo,
      cc,
      bcc,
      subject,
      body,
      signature,
      inReplyTo: context.inReplyTo,
      references: context.references,
    });

    const sendDelay = context.emailSendDelay ?? 5;
    if (sendDelay > 0 && context.threadId) {
      const scheduledSendTime = dayjs().add(sendDelay, "second").valueOf();
      const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
        orgId: context.orgId,
        threadId: context.threadId,
        emailPayload: JSON.stringify(emailPayload),
        scheduledSendTime,
        chatMessageId: context.chatMessageId,
        recipientEmail: sendTo,
        ccAddresses: cc.length > 0 ? cc : undefined,
        bccAddresses: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        attachments: attachments.length > 0 ? attachments : undefined,
        allowMultipleCoiAttachments,
        referencedPolicyIds: sourcePolicyIds.size > 0 ? ([...sourcePolicyIds] as Id<"policies">[]) : undefined,
        referencedQuoteIds: context.referencedQuoteIds,
      });
      await ctx.scheduler.runAfter(
        sendDelay * 1000,
        internal.actions.sendPendingEmail.sendPending,
        { id: pendingEmailId },
      );
      const pendingResult: EmailSubagentResult = {
        status: "pending",
        responseBody: `Sending email to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}...`,
        responseTo: sendTo,
        responseCc: cc.length > 0 ? cc : undefined,
        responseBcc: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        pendingEmailId,
        attachments,
      };
      finalResult = pendingResult;
      return pendingResult;
    }

    if (attachments.length > 0) {
      emailPayload.attachments = await toResendAttachments(ctx, attachments);
    }
    const sendOutcome = await sendResendEmail(emailPayload as Parameters<typeof sendResendEmail>[0]);
    if (!sendOutcome.ok) throw new Error(`Failed to send email: ${sendOutcome.error}`);
    const sentMessageId = sendOutcome.id;

    if (context.threadId) {
      await ctx.runMutation(internal.threads.insertEmailMessage, {
        threadId: context.threadId,
        orgId: context.orgId,
        role: "agent",
        content: body,
        toAddresses: [sendTo],
        ccAddresses: cc.length > 0 ? cc : undefined,
        bccAddresses: bcc.length > 0 ? bcc : undefined,
        subject,
        responseMessageId: sentMessageId,
        attachments: attachments.length > 0 ? attachments : undefined,
        referencedPolicyIds: sourcePolicyIds.size > 0 ? ([...sourcePolicyIds] as Id<"policies">[]) : undefined,
        referencedQuoteIds: context.referencedQuoteIds,
      });
    }

    const sentResult: EmailSubagentResult = {
      status: "sent",
      responseBody: `Email sent to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}.`,
      responseTo: sendTo,
      responseCc: cc.length > 0 ? cc : undefined,
      responseBcc: bcc.length > 0 ? bcc : undefined,
      subject,
      emailBody: body,
      responseMessageId: sentMessageId,
      attachments,
    };
    finalResult = sentResult;
    return sentResult;
  };

  const subagentResult = await generateText({
    model: await getModelForOrg(ctx, context.orgId, "email_draft"),
    providerOptions: getProviderOptionsForTask("email_draft"),
    maxOutputTokens: 1536,
    system: `You are Glass's email expert subagent.

You only handle Glass Agent outbound email. Your job is to draft or send polished insurance-business emails from ${context.agentAddress}.

Be careful by default:
- If the recipient email is missing, inferred, or not clearly the intended recipient, do not send. Produce a draft and ask for confirmation.
- If the request says "email me", "send me", or "email this to me", use the supplied default recipient as the recipient.
- If the subject, body, or requested attachments are ambiguous, do not send.
- If auto-send is disabled, draft first unless the caller says the user explicitly approved this exact email.
- Attach original policy PDFs or generated COIs when requested. Never claim an attachment is included unless you used an attachment tool or it was already attached.
- Available uploaded attachments may include files saved from connected mailboxes, including .eml exports of source emails. If the user asks to attach the email itself or proof from an email body, attach the saved .eml export with attach_uploaded_file.
- For certificate/COI delivery requests, attach only the generated COI unless the request separately asks for the original/full policy PDF too.
- When drafting COIs for multiple recipients, each recipient's email must include only that recipient's generated COI, not the full batch of generated COIs.
- When the user explicitly asks to bundle all COIs/certificates into one email for a single recipient, attach the requested COIs together in that one email.
- Use "certified COI" only when the attachment tool says the generated certificate is certified. Otherwise call it a non-binding COI or certificate.
- Do not call an attachment tool for a document that is already listed in preparedAttachments.
- Use concise professional formatting. Prefer 1-3 short paragraphs or a short bullet list.
- Include only the policy facts that are directly useful to the recipient. Avoid exhaustive coverage memos unless explicitly requested.
- Do not end with open-ended offers like "If you want, I can..." unless a necessary next step or clarification is required.
- No personal sign-off; the platform adds the Glass signature.

Call send_or_draft_email exactly once after preparing any requested attachments.`,
    messages: [{
      role: "user",
      content: JSON.stringify({
        channel: context.channel,
        request: input.request,
        supplied: {
          to: input.to ?? context.defaultTo,
          recipientName: input.recipientName,
          defaultRecipientName: context.defaultRecipientName,
          subject: input.subject ?? context.subjectHint,
          body: input.body,
          cc: defaultCc,
          bcc: defaultBcc,
          approvedToSend: input.approvedToSend === true,
        },
        requestedAttachments: input.attachments ?? [],
        attachmentSafetyWarning: safeRequestedAttachments.warning,
        preparedAttachments: preparedAttachments.map((att) => ({
          filename: att.filename,
          contentType: att.contentType,
          fileId: att.fileId,
        })),
        conversationContext: context.conversationContext,
        availablePolicies,
        availableUploadedAttachments: availableAttachments.map((att) => ({
          fileId: att.fileId,
          filename: att.filename,
          contentType: att.contentType,
        })),
      }),
    }],
    tools: {
      attach_original_policy: tool({
        description: "Attach the original PDF file for a policy.",
        inputSchema: z.object({
          policyId: z.string(),
        }),
        execute: async ({ policyId }) => attachOriginalPolicy(policyId),
      }),
      attach_uploaded_file: tool({
        description: "Attach a file that the user uploaded in this conversation.",
        inputSchema: z.object({
          fileId: z.string(),
          filename: z.string().optional(),
        }),
        execute: async ({ fileId, filename }) => attachUploadedFile(fileId, filename),
      }),
      generate_coi_attachment: tool({
        description: "Generate a COI PDF for a policy and attach it to the outbound email.",
        inputSchema: z.object({
          policyId: z.string(),
          certificateHolder: z.string().optional(),
          partnerProgramId: z.string().optional(),
        }),
        execute: async ({ policyId, certificateHolder, partnerProgramId }) =>
          generateCoiAttachment(policyId, certificateHolder, partnerProgramId),
      }),
      send_or_draft_email: tool({
        description: "Finalize the email. This either sends, queues, or returns a confirmation draft based on safety and org settings.",
        inputSchema: z.object({
          to: z.string().optional(),
          recipientName: z.string().optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          cc: z.array(z.string()).optional(),
          bcc: z.array(z.string()).optional(),
          approvedToSend: z.boolean().optional(),
        }),
        execute: sendOrDraftEmail,
      }),
    },
    stopWhen: stepCountIs(8),
  });

  if (finalResult) return finalResult;

  return {
    status: "draft",
    responseBody: subagentResult.text || "I drafted the email, but need confirmation before sending.",
  };
}
