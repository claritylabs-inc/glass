"use node";

import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import dayjs from "dayjs";
import { generateTextForOrg } from "./models";
import { buildAgentToolExecutors } from "./agentToolExecutors";
import type { AgentScope } from "./agentScope";
import { extractEmailAddress, normalizeEmailAddress } from "./emailAddress";
import { upsertEmailDraftArtifact } from "./emailDraftArtifacts";
import {
  buildEmailPayload,
  sendTrackedResendEmail,
  toResendAttachments,
  type EmailAttachmentMeta,
} from "./emailDelivery";
import {
  buildEmailSignature,
  type BrokerBranding,
} from "./emailIdentity";
import {
  isCoiAttachmentFilename,
  normalizeAttachmentText,
  resolveRequestedCoiAttachmentsForRecipient,
  shouldSuppressOriginalPolicyForCoiRequest,
  type RequestedEmailAttachment,
} from "./coiAttachmentGuards";

export {
  buildAgentEmailHtmlBody,
  buildEmailPayload,
  toResendAttachments,
  type EmailAttachmentMeta,
} from "./emailDelivery";
export {
  buildEmailSignature,
  getEmailAgentFromName,
  resolveEmailAgentIdentity,
  type BrokerBranding,
} from "./emailIdentity";
export { upsertEmailDraftArtifact } from "./emailDraftArtifacts";

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

type EmailExpertContext = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  threadId?: Id<"threads">;
  chatMessageId?: Id<"threadMessages">;
  channel: "web" | "email" | "imessage" | "mcp";
  fromHeader: string;
  agentAddress: string;
  replyTo?: string;
  brokerBranding?: BrokerBranding;
  senderEmail?: string;
  defaultTo?: string;
  defaultRecipientName?: string;
  defaultCc?: string[];
  defaultBcc?: string[];
  blockedCopyEmails?: string[];
  subjectHint?: string;
  inReplyTo?: string;
  references?: string;
  allowedRecipients?: string[];
  requireKnownRecipient?: boolean;
  missingRecipientMessage?: string;
  unknownRecipientMessage?: string;
  availableAttachments?: EmailAttachmentMeta[];
  referencedPolicyIds?: Id<"policies">[];
  autoSendEmails?: boolean;
  emailSendDelay?: number;
  conversationContext?: string;
  onResult?: (result: EmailSubagentResult) => void;
};

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
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function uniqueAttachments(
  attachments: EmailAttachmentMeta[],
): EmailAttachmentMeta[] {
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
      request: z
        .string()
        .describe("The user's full email request and any relevant context."),
      to: z.string().optional().describe("Recipient email address if known."),
      recipientName: z.string().optional().describe("Recipient name if known."),
      subject: z
        .string()
        .optional()
        .describe("Subject line if the user supplied or approved one."),
      body: z
        .string()
        .optional()
        .describe("Email body if already drafted or approved."),
      cc: z.array(z.string()).optional().describe("CC email addresses."),
      bcc: z.array(z.string()).optional().describe("BCC email addresses."),
      approvedToSend: z
        .boolean()
        .optional()
        .describe(
          "True only when the user explicitly approved sending this exact email.",
        ),
      attachments: z
        .array(
          z.object({
            kind: z.enum(["original_policy", "coi", "uploaded_file"]),
            policyId: z.string().optional(),
            fileId: z.string().optional(),
            filename: z.string().optional(),
            certificateHolder: z.string().optional(),
            holderContactName: z.string().optional(),
            holderEmail: z.string().optional(),
            holderPhone: z.string().optional(),
            addressLine1: z.string().optional(),
            addressLine2: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            requestText: z.string().optional(),
            requestedEndorsements: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe(
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
  const sourcePolicyIds = new Set(
    (context.referencedPolicyIds ?? []).map(String),
  );
  const suppressOriginalPolicyForCoiRequest =
    shouldSuppressOriginalPolicyForCoiRequest(input.request);
  const savedThreadAttachments = context.threadId
    ? ((await ctx.runQuery(internal.threads.listThreadAttachmentsInternal, {
        threadId: context.threadId,
        orgId: context.orgId,
        excludeEmailArtifacts: true,
        excludeAgentCoiAttachments: suppressOriginalPolicyForCoiRequest,
      })) as EmailAttachmentMeta[])
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
    if (!context.userId) {
      return "Cannot attach a policy document without an authenticated user context.";
    }
    if (suppressOriginalPolicyForCoiRequest) {
      return "Skipped original policy attachment because this request only asks for the generated COI.";
    }
    const requestPolicyKey = normalizeAttachmentText(policyId);
    if (attachedOriginalPolicyIds.has(requestPolicyKey)) {
      return "Original policy is already attached.";
    }
    let resolvedPolicyId: Id<"policies"> | undefined;
    let policyAttachment: EmailAttachmentMeta | undefined;
    const singleOrgScope: AgentScope = {
      mode: "client",
      surface: context.channel,
      primaryOrgId: context.orgId,
      readOrgIds: [context.orgId],
      writableOrgIds: [context.orgId],
      orgs: [],
      brokerInternal: false,
    };
    const executors = buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: context.orgId,
      userId: context.userId,
      scope: singleOrgScope,
      onPolicyReferenced: (referencedPolicyId) => {
        resolvedPolicyId = referencedPolicyId;
        sourcePolicyIds.add(String(referencedPolicyId));
      },
      onResponseAttachment: (attachment) => {
        if (!attachment.fileId) return;
        policyAttachment = {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          fileId: attachment.fileId,
        };
      },
    });
    const result = await executors.attach_policy_document.execute({ policyId });
    if (!policyAttachment) {
      return typeof result === "string"
        ? result
        : "That policy does not have an original file available.";
    }
    attachedOriginalPolicyIds.add(requestPolicyKey);
    if (resolvedPolicyId)
      attachedOriginalPolicyIds.add(String(resolvedPolicyId));
    addAttachment(policyAttachment);
    return `Attached original policy document: ${policyAttachment.filename}`;
  };

  const attachUploadedFile = (fileId: string, filename?: string): string => {
    if (!allowedAttachmentIds.has(fileId)) {
      return "That uploaded file is not available in this conversation.";
    }
    if (attachedUploadedFileIds.has(fileId)) {
      return "Uploaded file is already attached.";
    }
    const found = availableAttachments.find(
      (att) => String(att.fileId) === fileId,
    );
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
    holderContactName?: string,
    holderEmail?: string,
    holderPhone?: string,
    addressLine1?: string,
    addressLine2?: string,
    city?: string,
    state?: string,
    postalCode?: string,
    requestText?: string,
    requestedEndorsements?: string[],
    additionalInsuredName?: string,
  ): Promise<string> => {
    if (!context.userId) {
      return "Cannot generate a COI without an authenticated user context.";
    }
    const holderKey = normalizeAttachmentText(certificateHolder);
    const requestCoiKey = `${normalizeAttachmentText(policyId)}:${holderKey}`;
    if (attachedCoiKeys.has(requestCoiKey)) {
      return "Generated COI is already attached.";
    }
    let resolvedPolicyId: Id<"policies"> | undefined;
    let generatedAttachment: EmailAttachmentMeta | undefined;
    const singleOrgScope: AgentScope = {
      mode: "client",
      surface: context.channel,
      primaryOrgId: context.orgId,
      readOrgIds: [context.orgId],
      writableOrgIds: [context.orgId],
      orgs: [],
      brokerInternal: false,
    };
    const executors = buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: context.orgId,
      userId: context.userId,
      scope: singleOrgScope,
      onPolicyReferenced: (referencedPolicyId) => {
        resolvedPolicyId = referencedPolicyId;
        sourcePolicyIds.add(String(referencedPolicyId));
      },
      onResponseAttachment: (attachment) => {
        if (!attachment.fileId) return;
        generatedAttachment = {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          fileId: attachment.fileId,
        };
      },
    });
    const result = await executors.generate_coi.execute({
      policyId,
      certificateHolder,
      holderContactName,
      holderEmail,
      holderPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      requestText,
      requestedEndorsements,
      additionalInsuredName,
    });

    if (generatedAttachment) {
      const resolvedCoiKey = `${resolvedPolicyId ?? policyId}:${holderKey}`;
      attachedCoiKeys.add(requestCoiKey);
      attachedCoiKeys.add(resolvedCoiKey);
      addAttachment(generatedAttachment);
      generatedCoiAttachmentIds.add(String(generatedAttachment.fileId));
      return "Attached COI.";
    }

    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
      const output = result as {
        message?: string;
        attachment?: EmailAttachmentMeta;
      };
      if (output.attachment?.fileId) {
        const resolvedCoiKey = `${resolvedPolicyId ?? policyId}:${holderKey}`;
        attachedCoiKeys.add(requestCoiKey);
        attachedCoiKeys.add(resolvedCoiKey);
        addAttachment(output.attachment);
        generatedCoiAttachmentIds.add(String(output.attachment.fileId));
        return "Attached COI.";
      }
      if (output.message) return output.message;
    }
    return "COI request completed.";
  };

  if (
    safeRequestedAttachments.warning &&
    safeRequestedAttachments.attachments.length === 0
  ) {
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
      await generateCoiAttachment(
        requested.policyId,
        requested.certificateHolder,
        requested.holderContactName,
        requested.holderEmail,
        requested.holderPhone,
        requested.addressLine1,
        requested.addressLine2,
        requested.city,
        requested.state,
        requested.postalCode,
        requested.requestText,
        requested.requestedEndorsements,
      );
    } else if (requested.kind === "uploaded_file" && requested.fileId) {
      attachUploadedFile(requested.fileId, requested.filename);
    }
  }

  let finalResult: EmailSubagentResult | null = null;
  const policies = await ctx.runQuery(internal.policies.listAllInternal, {
    orgId: context.orgId,
  });
  const availablePolicies = (policies as Doc<"policies">[])
    .slice(0, 25)
    .map((policy) => ({
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
  const blockedCopyEmails = new Set(
    (context.blockedCopyEmails ?? [])
      .map(normalizeEmailAddress)
      .filter(Boolean),
  );
  const defaultCc = [
    ...new Set(
      [...(context.defaultCc ?? []), ...(input.cc ?? [])].filter(Boolean),
    ),
  ];
  const defaultBcc = [
    ...new Set(
      [...(context.defaultBcc ?? []), ...(input.bcc ?? [])].filter(Boolean),
    ),
  ];

  const sendOrDraftEmail = async (params: {
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    approvedToSend?: boolean;
  }): Promise<EmailSubagentResult> => {
    const to =
      extractEmailAddress(params.to) ??
      extractEmailAddress(input.to) ??
      extractEmailAddress(context.defaultTo);
    const subject = (
      params.subject ??
      input.subject ??
      context.subjectHint ??
      ""
    ).trim();
    const body = (params.body ?? input.body ?? "").trim();
    const cc = [
      ...new Set(
        [...(params.cc ?? []), ...defaultCc]
          .map(normalizeEmailAddress)
          .filter(
            (email) => email && email !== to && !blockedCopyEmails.has(email),
          ),
      ),
    ];
    const bcc = [
      ...new Set(
        [...(params.bcc ?? []), ...defaultBcc]
          .map(normalizeEmailAddress)
          .filter(
            (email) =>
              email &&
              email !== to &&
              !cc.includes(email) &&
              !blockedCopyEmails.has(email),
          ),
      ),
    ];
    const attachments = uniqueAttachments(preparedAttachments).filter(
      (attachment) => {
        if (
          !suppressOriginalPolicyForCoiRequest ||
          generatedCoiAttachmentIds.size === 0
        ) {
          return true;
        }
        return generatedCoiAttachmentIds.has(String(attachment.fileId));
      },
    );
    const approvedToSend =
      params.approvedToSend === true || input.approvedToSend === true;
    const autoSend = context.autoSendEmails === true;

    const uncertainty: string[] = [];
    if (!to) {
      uncertainty.push(
        context.missingRecipientMessage ??
          "Confirm the recipient email address.",
      );
    }
    if (!subject) uncertainty.push("Confirm the subject line.");
    if (!body) uncertainty.push("Confirm the email body.");
    const unknownRecipients = [to, ...cc, ...bcc]
      .filter((email): email is string => !!email)
      .filter(
        (email) =>
          allowedRecipients.length > 0 && !allowedRecipients.includes(email),
      );
    if (context.requireKnownRecipient && unknownRecipients.length > 0) {
      const message =
        context.unknownRecipientMessage ??
        "I cannot use that recipient because it is not a known contact in Glass. Add the contact in settings or provide the correct recipient explicitly.";
      finalResult = {
        status: "needs_confirmation",
        responseBody: message,
        confirmationReason: message,
      };
      return finalResult;
    }
    if (unknownRecipients.length > 0 && !approvedToSend) {
      uncertainty.push(
        `Confirm that ${unknownRecipients.join(", ")} ${unknownRecipients.length === 1 ? "is" : "are"} the intended recipient${unknownRecipients.length === 1 ? "" : "s"}.`,
      );
    }

    if (uncertainty.length > 0 || (!autoSend && !approvedToSend)) {
      const status = uncertainty.length > 0 ? "needs_confirmation" : "draft";
      const sendBlockedReason =
        uncertainty.length > 0 ? uncertainty.join(" ") : undefined;
      const referencedPolicyIds =
        sourcePolicyIds.size > 0
          ? ([...sourcePolicyIds] as Id<"policies">[])
          : undefined;
      const draftPendingEmailId =
        to && subject && body
          ? await upsertEmailDraftArtifact(ctx, context, {
              to,
              cc,
              bcc,
              subject,
              body,
              attachments,
              allowMultipleCoiAttachments,
              referencedPolicyIds,
              sendBlockedReason,
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
        confirmationReason:
          uncertainty.length > 0 ? uncertainty.join(" ") : "Ready to send?",
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
    const signature = buildEmailSignature(
      context.agentAddress,
      context.brokerBranding,
    );
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
      replyTo: context.replyTo,
    });

    const sendDelay = context.emailSendDelay ?? 5;
    if (sendDelay > 0 && context.threadId) {
      const scheduledSendTime = dayjs().add(sendDelay, "second").valueOf();
      const pendingEmailId = await ctx.runMutation(
        internal.pendingEmails.create,
        {
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
          fromHeader: context.fromHeader,
          replyTo: context.replyTo,
          inReplyTo: context.inReplyTo,
          references: context.references,
          renderedText: emailPayload.text,
          renderedHtml: emailPayload.html,
          attachments: attachments.length > 0 ? attachments : undefined,
          allowMultipleCoiAttachments,
          referencedPolicyIds:
            sourcePolicyIds.size > 0
              ? ([...sourcePolicyIds] as Id<"policies">[])
              : undefined,
        },
      );
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
    const sendOutcome = await sendTrackedResendEmail(ctx, {
      source: "email_subagent",
      orgId: context.orgId,
      threadId: context.threadId,
      recipientEmail: sendTo,
      ccAddresses: cc.length > 0 ? cc : undefined,
      bccAddresses: bcc.length > 0 ? bcc : undefined,
      subject,
      payload: emailPayload,
    });
    if (!sendOutcome.ok)
      throw new Error(`Failed to send email: ${sendOutcome.error}`);
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
        referencedPolicyIds:
          sourcePolicyIds.size > 0
            ? ([...sourcePolicyIds] as Id<"policies">[])
            : undefined,
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

  const subagentResult = await generateTextForOrg(ctx, context.orgId, "email_draft", {
    maxOutputTokens: 1536,
    system: `You are Glass's email expert subagent.

You only handle Glass Agent outbound email. Your job is to draft or send polished insurance-business emails from ${context.agentAddress}.

Be careful by default:
- If the recipient email is missing, inferred, or not clearly the intended recipient, do not send. Produce a draft and ask for confirmation.
- Never invent broker, carrier, underwriter, MGA, client, or vendor recipient emails. If a requested recipient is not supplied or present in known contacts/context, ask for the missing contact information instead.
- If the request says "email me", "send me", or "email this to me", use the supplied default recipient as the recipient.
- If the subject, body, or requested attachments are ambiguous, do not send.
- If auto-send is disabled, draft first unless the caller says the user explicitly approved this exact email.
- Attach original policy PDFs or generated COIs when requested. Never claim an attachment is included unless you used an attachment tool or it was already attached.
- Available uploaded attachments may include files saved from connected mailboxes, including .eml exports of source emails. If the user asks to attach the email itself or proof from an email body, attach the saved .eml export with attach_uploaded_file.
- For certificate/COI delivery requests, attach only the generated COI unless the request separately asks for the original/full policy PDF too.
- When drafting COIs for multiple recipients, each recipient's email must include only that recipient's generated COI, not the full batch of generated COIs.
- When the user explicitly asks to bundle all COIs/certificates into one email for a single recipient, attach the requested COIs together in that one email.
- Treat generated COIs as informational certificates. Do not call them certified, approved, binding, or reviewed.
- Do not call an attachment tool for a document that is already listed in preparedAttachments.
- Use concise professional formatting. Prefer 1-3 short paragraphs or a short bullet list.
- Include only the policy facts that are directly useful to the recipient. Avoid exhaustive coverage memos unless explicitly requested.
- Do not end with open-ended offers like "If you want, I can..." unless a necessary next step or clarification is required.
- No personal sign-off; the platform adds the Glass signature.

Call send_or_draft_email exactly once after preparing any requested attachments.`,
    messages: [
      {
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
            recipientGuard: context.requireKnownRecipient
              ? {
                  requireKnownRecipient: true,
                  missingRecipientMessage: context.missingRecipientMessage,
                  unknownRecipientMessage: context.unknownRecipientMessage,
                }
              : undefined,
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
      },
    ],
    tools: {
      attach_original_policy: tool({
        description: "Attach the original PDF file for a policy.",
        inputSchema: z.object({
          policyId: z.string(),
        }),
        execute: async ({ policyId }) => attachOriginalPolicy(policyId),
      }),
      attach_uploaded_file: tool({
        description:
          "Attach a file that the user uploaded in this conversation.",
        inputSchema: z.object({
          fileId: z.string(),
          filename: z.string().optional(),
        }),
        execute: async ({ fileId, filename }) =>
          attachUploadedFile(fileId, filename),
      }),
      generate_coi_attachment: tool({
        description:
          "Generate a COI PDF for a policy and attach it to the outbound email.",
        inputSchema: z.object({
          policyId: z.string(),
          certificateHolder: z.string().optional(),
          holderContactName: z.string().optional(),
          holderEmail: z.string().optional(),
          holderPhone: z.string().optional(),
          addressLine1: z.string().optional(),
          addressLine2: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          postalCode: z.string().optional(),
          requestText: z.string().optional(),
          requestedEndorsements: z.array(z.string()).optional(),
          additionalInsuredName: z.string().optional(),
        }),
        execute: async ({
          policyId,
          certificateHolder,
          holderContactName,
          holderEmail,
          holderPhone,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          requestText,
          requestedEndorsements,
          additionalInsuredName,
        }) =>
          generateCoiAttachment(
            policyId,
            certificateHolder,
            holderContactName,
            holderEmail,
            holderPhone,
            addressLine1,
            addressLine2,
            city,
            state,
            postalCode,
            requestText,
            requestedEndorsements,
            additionalInsuredName,
          ),
      }),
      send_or_draft_email: tool({
        description:
          "Finalize the email. This either sends, queues, or returns a confirmation draft based on safety and org settings.",
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
    responseBody:
      subagentResult.text ||
      "I drafted the email, but need confirmation before sending.",
  };
}
