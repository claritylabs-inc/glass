"use node";

import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getModelForOrg, getProviderOptionsForTask } from "./models";
import { sendResendEmail, getAgentDomain } from "./resend";
import { markdownToHtml, stripMarkdown } from "./aiUtils";
import { isWhiteLabelingEnabled } from "./branding";

const MAX_EMAIL_SIZE = 38 * 1024 * 1024; // Resend limit is 40MB after Base64 encoding.

export type EmailAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  fileId: Id<"_storage">;
};

export type EmailSubagentResult = {
  status: "draft" | "needs_confirmation" | "pending" | "sent" | "error";
  responseBody: string;
  responseTo?: string;
  responseCc?: string[];
  subject?: string;
  emailBody?: string;
  responseMessageId?: string;
  pendingEmailId?: Id<"pendingEmails">;
  attachments?: EmailAttachmentMeta[];
};

export type BrokerBranding = {
  name?: string;
  logoUrl?: string | null;
  agentDisplayName?: string | null;
};

type EmailExpertContext = {
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  legacyConversationId?: Id<"agentConversations">;
  chatMessageId?: Id<"threadMessages">;
  channel: "web" | "email" | "imessage";
  fromHeader: string;
  agentAddress: string;
  brokerBranding?: BrokerBranding;
  senderEmail?: string;
  defaultTo?: string;
  defaultCc?: string[];
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
  const poweredByUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";
  const hasBroker = !!(broker?.name || broker?.agentDisplayName);
  const agentName = getEmailAgentFromName(broker);

  const text = [
    "",
    "-",
    agentName,
    agentEmail,
    "",
    `powered by Glass from Clarity Labs - ${poweredByUrl}`,
  ].join("\n");

  const logoHtml = hasBroker && broker?.logoUrl
    ? `<img src="${broker.logoUrl}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:4px;margin-right:8px;object-fit:cover;border:0;" />`
    : `<span style="color:#A0D2FA;font-size:15px;font-family:'Segoe UI Symbol','Apple Symbols',sans-serif;margin-right:6px">&#x2733;&#xFE0E;</span>`;

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">-</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${agentName}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    `<p style="font-size:12px;margin:12px 0 0"><a href="${poweredByUrl}" style="color:#A0D2FA;text-decoration:none">powered by Glass from Clarity Labs</a></p>`,
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

  const handle = typeof sendingOrg.agentHandle === "string" ? sendingOrg.agentHandle : undefined;
  if (!handle) {
    return { canSend: false, reason: "No Glass agent email handle is configured." };
  }

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

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function extractEmail(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match ? normalizeEmail(match[0]) : null;
}

function formatDraft(params: {
  to?: string;
  cc?: string[];
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
      approvedToSend: z.boolean().optional().describe("True only when the user explicitly approved sending this exact email."),
      attachments: z.array(z.object({
        kind: z.enum(["original_policy", "coi", "uploaded_file"]),
        policyId: z.string().optional(),
        fileId: z.string().optional(),
        filename: z.string().optional(),
        certificateHolder: z.string().optional(),
      })).optional().describe("Documents the user asked to attach."),
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
    approvedToSend?: boolean;
    attachments?: Array<{
      kind: "original_policy" | "coi" | "uploaded_file";
      policyId?: string;
      fileId?: string;
      filename?: string;
      certificateHolder?: string;
    }>;
  },
): Promise<EmailSubagentResult> {
  const preparedAttachments: EmailAttachmentMeta[] = [];
  const allowedAttachmentIds = new Set(
    (context.availableAttachments ?? []).map((att) => String(att.fileId)),
  );

  const addAttachment = (attachment: EmailAttachmentMeta) => {
    preparedAttachments.push(attachment);
  };

  const attachOriginalPolicy = async (policyId: string): Promise<string> => {
    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: policyId as Id<"policies">,
    });
    if (!policy || policy.orgId !== context.orgId) return "Policy not found.";
    if (!policy.fileId) return "That policy does not have an original file available.";
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
    const found = (context.availableAttachments ?? []).find((att) => String(att.fileId) === fileId);
    if (!found) return "Uploaded file not found.";
    addAttachment({ ...found, filename: filename ?? found.filename });
    return `Attached uploaded file: ${filename ?? found.filename}`;
  };

  const generateCoiAttachment = async (policyId: string, certificateHolder?: string): Promise<string> => {
    if (context.autoGenerateCoi === false) {
      if (context.coiHandling === "broker") return "COI auto-generation is off. Contact the broker before attaching a COI.";
      if (context.coiHandling === "member") return "COI auto-generation is off. Confirm the org's insurance contact should handle this COI.";
      return "COI auto-generation is disabled.";
    }
    const storageId = await ctx.runAction(internal.actions.generateCoi.run, {
      policyId: policyId as Id<"policies">,
      orgId: context.orgId,
      certificateHolder,
    });
    if (!storageId) return "Failed to generate COI.";
    addAttachment({
      filename: "certificate-of-insurance.pdf",
      contentType: "application/pdf",
      size: 0,
      fileId: storageId as Id<"_storage">,
    });
    return "Attached generated COI.";
  };

  for (const requested of input.attachments ?? []) {
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
  const availablePolicies = policies.slice(0, 25).map((policy) => ({
    id: policy._id,
    insured: policy.insuredName,
    carrier: policy.security ?? policy.carrier,
    type: policy.policyTypes?.join(", "),
    number: policy.policyNumber,
    fileName: policy.fileName,
    hasOriginalFile: !!policy.fileId,
  }));

  const allowedRecipients = (context.allowedRecipients ?? [])
    .map(normalizeEmail)
    .filter(Boolean);
  const defaultCc = [...new Set([...(context.defaultCc ?? []), ...(input.cc ?? [])].filter(Boolean))];

  const sendOrDraftEmail = async (params: {
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    approvedToSend?: boolean;
  }): Promise<EmailSubagentResult> => {
    const to = extractEmail(params.to) ?? extractEmail(input.to) ?? extractEmail(context.defaultTo);
    const recipientName = params.recipientName?.trim() || input.recipientName?.trim();
    const subject = (params.subject ?? input.subject ?? context.subjectHint ?? "").trim();
    const body = (params.body ?? input.body ?? "").trim();
    const cc = [...new Set([...(params.cc ?? []), ...defaultCc].map(normalizeEmail).filter((email) => email && email !== to))];
    const attachments = uniqueAttachments(preparedAttachments);
    const approvedToSend = params.approvedToSend === true || input.approvedToSend === true;
    const autoSend = context.autoSendEmails === true;

    const uncertainty: string[] = [];
    if (!to) uncertainty.push("Confirm the recipient email address.");
    if (!recipientName) uncertainty.push("Confirm the recipient name.");
    if (!subject) uncertainty.push("Confirm the subject line.");
    if (!body) uncertainty.push("Confirm the email body.");
    const knownRecipient = !!to && (allowedRecipients.length === 0 || allowedRecipients.includes(to));
    if (to && !knownRecipient && !approvedToSend) {
      uncertainty.push(`Confirm that ${to} is the intended recipient.`);
    }

    if (uncertainty.length > 0 || (!autoSend && !approvedToSend)) {
      const status = uncertainty.length > 0 ? "needs_confirmation" : "draft";
      finalResult = {
        status,
        responseBody: formatDraft({
          to: to ?? undefined,
          cc,
          subject,
          body,
          attachments,
          reason: uncertainty.length > 0 ? uncertainty.join(" ") : undefined,
        }),
        responseTo: to ?? undefined,
        responseCc: cc.length > 0 ? cc : undefined,
        subject,
        emailBody: body,
        attachments,
      };
      return finalResult;
    }

    if (!to) throw new Error("Recipient email is required before sending.");
    const sendTo = to;
    const signature = buildEmailSignature(context.agentAddress, context.brokerBranding);
    const plainText = stripMarkdown(body) + signature.text;
    const html = buildHtmlBody(body, signature);
    const emailPayload: Record<string, unknown> = {
      from: context.fromHeader,
      to: sendTo,
      subject,
      text: plainText,
      html,
    };
    if (cc.length > 0) emailPayload.cc = cc;
    const headers: Record<string, string> = {};
    if (context.inReplyTo) headers["In-Reply-To"] = context.inReplyTo;
    if (context.references ?? context.inReplyTo) headers.References = context.references ?? context.inReplyTo!;
    if (Object.keys(headers).length > 0) emailPayload.headers = headers;

    const sendDelay = context.emailSendDelay ?? 5;
    if (sendDelay > 0 && context.threadId) {
      const scheduledSendTime = Date.now() + sendDelay * 1000;
      const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
        orgId: context.orgId,
        threadId: context.threadId,
        emailPayload: JSON.stringify(emailPayload),
        scheduledSendTime,
        chatMessageId: context.chatMessageId,
        legacyConversationId: context.legacyConversationId,
        recipientEmail: sendTo,
        ccAddresses: cc.length > 0 ? cc : undefined,
        subject,
        emailBody: body,
        attachments: attachments.length > 0 ? attachments : undefined,
        referencedPolicyIds: context.referencedPolicyIds,
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
        subject,
        responseMessageId: sentMessageId,
        attachments: attachments.length > 0 ? attachments : undefined,
        referencedPolicyIds: context.referencedPolicyIds,
        referencedQuoteIds: context.referencedQuoteIds,
        legacyConversationId: context.legacyConversationId,
      });
    }

    const sentResult: EmailSubagentResult = {
      status: "sent",
      responseBody: `Email sent to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}.`,
      responseTo: sendTo,
      responseCc: cc.length > 0 ? cc : undefined,
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
    maxOutputTokens: 2048,
    system: `You are Glass's email expert subagent.

You only handle Glass Agent outbound email. Your job is to draft or send polished insurance-business emails from ${context.agentAddress}.

Be careful by default:
- If the recipient email is missing, inferred, or not clearly the intended recipient, do not send. Produce a draft and ask for confirmation.
- If the recipient name is missing, do not send. Ask for confirmation of the name.
- If the subject, body, or requested attachments are ambiguous, do not send.
- If auto-send is disabled, draft first unless the caller says the user explicitly approved this exact email.
- Attach original policy PDFs or generated COIs when requested. Never claim an attachment is included unless you used an attachment tool or it was already attached.
- Use concise professional formatting. No personal sign-off; the platform adds the Glass signature.

Call send_or_draft_email exactly once after preparing any requested attachments.`,
    messages: [{
      role: "user",
      content: JSON.stringify({
        channel: context.channel,
        request: input.request,
        supplied: {
          to: input.to ?? context.defaultTo,
          recipientName: input.recipientName,
          subject: input.subject ?? context.subjectHint,
          body: input.body,
          cc: defaultCc,
          approvedToSend: input.approvedToSend === true,
        },
        conversationContext: context.conversationContext,
        availablePolicies,
        availableUploadedAttachments: context.availableAttachments?.map((att) => ({
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
        }),
        execute: async ({ policyId, certificateHolder }) => generateCoiAttachment(policyId, certificateHolder),
      }),
      send_or_draft_email: tool({
        description: "Finalize the email. This either sends, queues, or returns a confirmation draft based on safety and org settings.",
        inputSchema: z.object({
          to: z.string().optional(),
          recipientName: z.string().optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          cc: z.array(z.string()).optional(),
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
