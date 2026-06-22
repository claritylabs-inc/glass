"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import {
  extractPolicyAttachment,
  createImessageGroupChat,
  searchConnectedEmail,
  readConnectedEmail,
  readConnectedEmailAttachment,
  importConnectedEmailPolicyAttachments,
  importConnectedEmailRequirementAttachments,
  sendConnectedVendorInvite,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { Webhook } from "svix";
import {
  buildConversationMemoryContext,
  buildScopedDocumentContext,
  buildScopedOrgMemoryContext,
  buildScopedRequirementsContext,
} from "../lib/agentPrompts";
import type { Doc, Id } from "../_generated/dataModel";
import type { AgentScope } from "../lib/agentScope";
import {
  sendResendEmail,
  getAgentDomain,
  getAgentDomains,
  isGlassOutboundAddress,
} from "../lib/resend";
import { buildGlassEmailIconHtml } from "../lib/emailTemplate";
import {
  buildSystemPromptForContext,
  buildBrokerPortfolioSystemPrompt,
  buildChannelInstructions,
  buildPolicyToolInstructions,
} from "../lib/aiUtils";
import { tryBuildParsedPdfText } from "../lib/liteparsePreprocessor";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  enforceInputLimits,
  validateEmailRecipient,
} from "../lib/security";
import { isWhiteLabelingEnabled } from "../lib/branding";
import { getClientPortalUrl } from "../lib/domains";
import {
  buildEmailExpertTool,
  toResendAttachments,
  type EmailAttachmentMeta,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { isBrokerDirectedEmailRequest } from "../lib/emailIntentGuards";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import {
  formatCertificateProgramSelectionForModel,
  type CertificateProgramSelection,
} from "../lib/certificateProgramSelection";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import {
  buildEmailDraftTextSummary,
  isSendAllEmailDraftsIntent,
  isShowMoreEmailDraftIntent,
} from "../lib/emailDraftSummary";

const GLASS_PUBLIC_URL = getClientPortalUrl();
const GLASS_PENDING_MESSAGE_ID_RE = /<?glass-pending-([^@\s>]+)@[^>\s]+>?/gi;

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
]);

function getCompanyDomains(
  org: { website?: string },
  memberEmails: string[],
): string[] {
  const domains: string[] = [];
  if (org.website) {
    try {
      const hostname = new URL(org.website).hostname.replace(/^www\./, "");
      if (!CONSUMER_DOMAINS.has(hostname)) domains.push(hostname);
    } catch {
      /* ignore invalid URLs */
    }
  }
  for (const email of memberEmails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !CONSUMER_DOMAINS.has(domain) && !domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return domains;
}

function extractPendingEmailIdsFromHeaders(values: Array<string | undefined>) {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(GLASS_PENDING_MESSAGE_ID_RE)) {
      const pendingEmailId = match[1]?.trim();
      if (pendingEmailId) ids.add(pendingEmailId);
    }
  }
  return [...ids];
}

interface WebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    message_id?: string;
    attachments?: unknown[];
  };
}

interface ReceivedEmailContent {
  html?: string;
  text?: string;
  headers?: unknown;
}

function extractEmailAddress(raw: string | undefined): string {
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : raw.toLowerCase().trim();
}

function extractName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : undefined;
}

function parseAddressList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((a) => extractEmailAddress(a)).filter(Boolean);
  }
  return raw
    .split(",")
    .map((a) => extractEmailAddress(a.trim()))
    .filter(Boolean);
}

function findAgentHandle(
  addresses: string[],
): { handle: string; threadSuffix?: string } | null {
  for (const addr of addresses) {
    const domain = addr.split("@").pop()?.toLowerCase();
    if (domain && getAgentDomains().includes(domain)) {
      const localPart = addr.split("@")[0];
      // Parse handle+threadSuffix format (e.g. "company+abc12345@agent.domain")
      const plusIdx = localPart.indexOf("+");
      if (plusIdx !== -1) {
        return {
          handle: localPart.slice(0, plusIdx),
          threadSuffix: localPart.slice(plusIdx + 1),
        };
      }
      return { handle: localPart };
    }
  }
  return null;
}

function stripQuotedText(body: string): string {
  const onWrotePattern = /\r?\n\s*On .+wrote:\s*\r?\n[\s\S]*$/;
  let cleaned = body.replace(onWrotePattern, "");
  cleaned = cleaned.replace(
    /\r?\n\s*-{5,}\s*Forwarded message\s*-{5,}[\s\S]*$/,
    "",
  );
  const lines = cleaned.split("\n");
  while (lines.length > 0 && /^\s*>/.test(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

function extractForwardedSender(body: string): string | null {
  const gmailMatch = body.match(
    /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?From:\s*(?:[^<]*<)?([^\s<>]+@[^\s<>]+)/i,
  );
  if (gmailMatch) return gmailMatch[1].toLowerCase();
  const appleMatch = body.match(
    /Begin forwarded message:[\s\S]*?From:\s*(?:[^<]*<)?([^\s<>]+@[^\s<>]+)/i,
  );
  if (appleMatch) return appleMatch[1].toLowerCase();
  const outlookMatch = body.match(
    /From:\s*(?:[^<]*<)?([^\s<>]+@[^\s<>]+)[\s\S]*?Sent:\s*/i,
  );
  if (outlookMatch) return outlookMatch[1].toLowerCase();
  return null;
}

interface BrokerBranding {
  name?: string;
  logoUrl?: string | null;
  agentDisplayName?: string | null;
}

function getAgentFromName(broker?: BrokerBranding): string {
  if (broker?.name || broker?.agentDisplayName) {
    const base = broker.agentDisplayName || broker.name;
    return `${base} Agent`;
  }
  return "Glass from Clarity Labs";
}

function buildSignature(
  agentEmail: string,
  broker?: BrokerBranding,
): { text: string; html: string } {
  const poweredByUrl = GLASS_PUBLIC_URL;
  const hasBroker = !!(broker?.name || broker?.agentDisplayName);
  const agentName = getAgentFromName(broker);

  const text = [
    "",
    "—",
    agentName,
    agentEmail,
    ...(hasBroker
      ? ["", `powered by Glass from Clarity Labs — ${poweredByUrl}`]
      : []),
  ].join("\n");

  const logoHtml =
    hasBroker && broker?.logoUrl
      ? `<img src="${broker.logoUrl}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:4px;margin-right:8px;object-fit:cover;border:0;" />`
      : buildGlassEmailIconHtml({
          size: 20,
          borderRadius: 4,
          margin: "0 8px 0 0",
        });

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">—</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${agentName}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    ...(hasBroker
      ? [
          `<p style="font-size:12px;margin:6px 0 0"><a href="${poweredByUrl}" style="color:#A0D2FA;text-decoration:none">powered by Glass from Clarity Labs</a></p>`,
        ]
      : []),
  ].join("\n");

  return { text, html };
}

interface AttachmentMeta {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  download_url: string;
}

interface DownloadedAttachment {
  filename: string;
  content_type: string;
  size: number;
  buffer: Buffer;
}

type ToolSentEmail = {
  responseBody: string;
  responseTo: string;
  responseCc?: string[];
  responseMessageId?: string;
};

type EmailThreadMode = "direct" | "cc" | "forward" | "unknown";

type InboundThreadResolution = {
  existingThreadId?: Id<"threads">;
  threadRootMode?: EmailThreadMode;
  matchedParentEmailMessage: Doc<"threadMessages"> | null;
  correlatedPolicyChangeCaseId?: Id<"policyChangeCases">;
  correlatedPendingEmailId?: Id<"pendingEmails">;
};

const SUPPORTED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

async function fetchAttachments(
  emailId: string,
): Promise<DownloadedAttachment[]> {
  const downloaded: DownloadedAttachment[] = [];

  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}/attachments`,
      {
        headers: {
          Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        },
      },
    );
    if (!res.ok) {
      console.warn(`Failed to fetch attachments (${res.status})`);
      return [];
    }

    const body = await res.json();
    const attachments: AttachmentMeta[] = body.data ?? body ?? [];

    for (const att of attachments) {
      if (att.size > MAX_ATTACHMENT_SIZE) continue;

      try {
        const dlRes = await fetch(att.download_url);
        if (!dlRes.ok) continue;

        const buffer = Buffer.from(await dlRes.arrayBuffer());
        downloaded.push({
          filename: att.filename,
          content_type: att.content_type,
          size: att.size,
          buffer,
        });
      } catch (err) {
        console.warn(`Failed to download attachment ${att.filename}:`, err);
      }
    }
  } catch (err) {
    console.warn("Failed to fetch attachment list:", err);
  }

  return downloaded;
}

async function fetchEmailContent(
  emailId: string,
): Promise<ReceivedEmailContent> {
  const res = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      },
    },
  );
  if (!res.ok) {
    console.warn(
      `Failed to fetch from receiving API (${res.status}), trying sent emails API...`,
    );
    const fallback = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      },
    });
    if (!fallback.ok) {
      const errorText = await fallback.text();
      console.error("Both APIs failed. Proceeding without body.", errorText);
      return {};
    }
    return await fallback.json();
  }
  return await res.json();
}

async function resolveInboundThreadAndPolicyChange(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    fromEmail: string;
    subject: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    threadSuffix?: string;
    agentAddressWithSuffix?: string | null;
  },
): Promise<InboundThreadResolution> {
  let existingThreadId: Id<"threads"> | undefined;
  let threadRootMode: EmailThreadMode | undefined;
  let matchedParentEmailMessage: Doc<"threadMessages"> | null = null;
  let correlatedPolicyChangeCaseId: Id<"policyChangeCases"> | undefined;
  let correlatedPendingEmailId: Id<"pendingEmails"> | undefined;

  const replyMessageIdCandidates = [
    args.inReplyTo,
    ...(args.references ? args.references.trim().split(/\s+/).reverse() : []),
  ].filter((value): value is string => Boolean(value?.trim()));

  const deterministicPendingEmailIds = extractPendingEmailIdsFromHeaders([
    args.messageId,
    args.inReplyTo,
    args.references,
  ]);
  for (const pendingEmailId of deterministicPendingEmailIds) {
    const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: pendingEmailId as Id<"pendingEmails">,
    }).catch(() => null) as Doc<"pendingEmails"> | null;
    if (!pending || pending.orgId !== args.orgId) continue;
    correlatedPendingEmailId = pending._id;
    correlatedPolicyChangeCaseId = pending.policyChangeCaseId;
    if (pending.threadMessageId) {
      matchedParentEmailMessage = await ctx.runQuery(
        internal.threads.getMessageInternal,
        { id: pending.threadMessageId },
      ).catch(() => null) as Doc<"threadMessages"> | null;
    }
    if (pending.threadId) {
      existingThreadId = pending.threadId;
      const parentThread = await ctx.runQuery(internal.threads.getInternal, {
        id: pending.threadId,
      });
      threadRootMode = parentThread?.emailMode;
    }
    break;
  }

  for (const candidate of [...new Set(replyMessageIdCandidates)]) {
    if (matchedParentEmailMessage && correlatedPolicyChangeCaseId) break;
    const matched = await ctx.runQuery(
      internal.threads.findEmailMessageByMessageId,
      { orgId: args.orgId, messageId: candidate },
    ) as Doc<"threadMessages"> | null;
    if (!matched) continue;
    matchedParentEmailMessage = matched;
    existingThreadId = matched.threadId;
    correlatedPendingEmailId = matched.pendingEmailId;
    const pending = matched.pendingEmailId
      ? await ctx.runQuery(internal.pendingEmails.getInternal, {
          id: matched.pendingEmailId,
        }) as Doc<"pendingEmails"> | null
      : null;
    correlatedPolicyChangeCaseId =
      matched.policyChangeCaseId ?? pending?.policyChangeCaseId;
    const parentThread = await ctx.runQuery(internal.threads.getInternal, {
      id: matched.threadId,
    });
    threadRootMode = parentThread?.emailMode;
    break;
  }

  if (!existingThreadId && args.threadSuffix && args.agentAddressWithSuffix) {
    const unifiedThread = await ctx.runQuery(internal.threads.findByEmail, {
      threadEmail: args.agentAddressWithSuffix,
    });
    if (unifiedThread) {
      existingThreadId = unifiedThread._id;
      threadRootMode = unifiedThread.emailMode;
    }
  }

  if (!existingThreadId && args.inReplyTo) {
    const parent = await ctx.runQuery(
      internal.threads.findThreadByEmailMessageId,
      { orgId: args.orgId, messageId: args.inReplyTo },
    );
    if (parent) {
      existingThreadId = parent._id;
      threadRootMode = parent.emailMode;
    }
  }

  if (!existingThreadId) {
    const subjectMatch = await ctx.runQuery(
      internal.threads.findEmailThreadBySubject,
      { orgId: args.orgId, subject: args.subject, fromEmail: args.fromEmail },
    );
    if (subjectMatch) {
      existingThreadId = subjectMatch._id;
      threadRootMode = subjectMatch.emailMode;
    }
  }

  if (existingThreadId && !correlatedPolicyChangeCaseId) {
    const singleWaitingCase = await ctx.runQuery(
      internal.policyChanges.findSingleWaitingForEndorsementCaseInThreadInternal,
      { orgId: args.orgId, threadId: existingThreadId },
    ) as Doc<"policyChangeCases"> | null;
    if (singleWaitingCase) {
      correlatedPolicyChangeCaseId = singleWaitingCase._id;
    }
  }

  return {
    existingThreadId,
    threadRootMode,
    matchedParentEmailMessage,
    correlatedPolicyChangeCaseId,
    correlatedPendingEmailId,
  };
}

export const processInbound = internalAction({
  args: {
    payload: v.string(),
    svixId: v.string(),
    svixTimestamp: v.string(),
    svixSignature: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify webhook signature
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret) {
      const wh = new Webhook(webhookSecret);
      try {
        wh.verify(args.payload, {
          "svix-id": args.svixId,
          "svix-timestamp": args.svixTimestamp,
          "svix-signature": args.svixSignature,
        });
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        throw new Error("Invalid webhook signature");
      }
    } else {
      console.warn(
        "RESEND_WEBHOOK_SECRET not set — skipping signature verification",
      );
    }

    const webhook: WebhookPayload = JSON.parse(args.payload);
    const data = webhook.data ?? webhook;

    // Dedup
    const resendEmailId = data.email_id;
    if (resendEmailId || data.message_id) {
      const isDuplicate = await ctx.runQuery(
        internal.threads.checkDuplicateEmail,
        {
          resendEmailId: resendEmailId || undefined,
          messageId: data.message_id || undefined,
        },
      );
      if (isDuplicate) {
        console.log(
          "Duplicate webhook - already processed email:",
          resendEmailId ?? data.message_id,
        );
        return;
      }
    }

    const fromEmail = extractEmailAddress(data.from);
    const fromName = extractName(data.from);
    const toAddresses = parseAddressList(data.to);
    const ccAddresses = parseAddressList(data.cc);
    const allAddresses = [...toAddresses, ...ccAddresses];

    if (!fromEmail) {
      console.error("No from address found in payload");
      return;
    }

    // Loop prevention
    if (isGlassOutboundAddress(fromEmail)) {
      console.log(
        "Loop prevention: ignoring email from agent domain",
        fromEmail,
      );
      return;
    }

    // Find agent handle (may include +threadSuffix for thread-specific routing)
    const handleResult = findAgentHandle(allAddresses);
    if (!handleResult) {
      console.log("No agent handle found in recipients:", allAddresses);
      return;
    }
    const { handle, threadSuffix } = handleResult;

    // Resolve the broker org that owns this handle, then figure out which of
    // their clients the sender is acting for.
    const resolved = await ctx.runQuery(internal.orgs.resolveClientBySender, {
      handle,
      senderEmail: fromEmail,
    });
    if (!resolved) {
      console.log("No organization found for handle:", handle);
      if (handle !== "agent") return;
      const emailContent = data.email_id
        ? await fetchEmailContent(data.email_id)
        : {};
      const rawBody = emailContent.text ?? "";
      const body = stripQuotedText(rawBody);
      const guardedInput = enforceInputLimits(
        [data.subject ?? "", body].join("\n\n"),
      );
      const injectionCheck = await classifyPromptInjection(guardedInput);
      if (!injectionCheck.safe) {
        console.warn("[security] Prompt injection blocked in public demo email", {
          fromEmail,
          reason: injectionCheck.reason,
        });
        return;
      }

      const agentAddress = `${handle}@${getAgentDomain()}`;
      const demo = await ctx.runAction(
        internal.actions.publicDemoAgent.respond,
        {
          channel: "email",
          senderContact: fromEmail,
          messageText: body || data.subject || "Tell me about Glass.",
          subject: data.subject,
          fromName,
          fromEmail,
          agentAddress,
          sourceMessageId: data.message_id,
          resendEmailId: resendEmailId || undefined,
        },
      );
      const subject = data.subject
        ? /^re:/i.test(data.subject)
          ? data.subject
          : `Re: ${data.subject}`
        : "Re: Glass product demo";
      const headers: Record<string, string> = {};
      if (data.message_id) {
        headers["In-Reply-To"] = data.message_id;
        headers["References"] = data.message_id;
      }
      const result = await sendResendEmail({
        from: `Glass from Clarity Labs <${agentAddress}>`,
        to: fromEmail,
        subject,
        html: demo.html,
        text: demo.text,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      await ctx.runMutation(internal.publicDemo.patchChatLogDelivery, {
        id: demo.outboundLogId,
        deliveryStatus: result.ok ? "sent" : "failed",
        deliveryId: result.ok ? result.id : result.error,
      });
      if (!result.ok) {
        console.warn("Failed to send public demo email:", result.error);
      }
      return;
    }
    const { brokerOrg, clientOrg } = resolved;
    // If the handle matches the broker but no client matches the sender, fall
    // back to operating in the broker's own workspace (e.g. internal mail).
    const org = clientOrg ?? brokerOrg;
    const orgId = org._id;
    if (!clientOrg) {
      console.log(
        `No client matched for sender ${fromEmail} on handle ${handle}; operating on broker org ${brokerOrg._id}.`,
      );
    }

    // Get all org members for domain detection and primary contact resolution
    const orgMembers = await ctx.runQuery(internal.orgs.getMembersInternal, {
      orgId,
    });
    const memberEmails = orgMembers
      .map((m: any) => m.user?.email)
      .filter(Boolean) as string[];
    const firstAdmin = orgMembers.find((m: any) => m.role === "admin");

    // Match sender to an org member by email — so the right user is attributed
    const senderMember = orgMembers.find(
      (m: any) => m.user?.email?.toLowerCase() === fromEmail.toLowerCase(),
    );
    const primaryUserId =
      senderMember?.userId ??
      org.primaryInsuranceContactId ??
      firstAdmin?.userId;

    if (!primaryUserId) {
      console.log("No primary user found for org:", orgId);
      return;
    }

    // Fetch full email content and attachments from Resend API
    const emailContent = await fetchEmailContent(data.email_id);
    const rawBody = emailContent.text ?? "";
    const body = stripQuotedText(rawBody);
    const bodyHtml = emailContent.html ?? undefined;
    const attachments = await fetchAttachments(data.email_id);

    const guardedInput = enforceInputLimits(
      [data.subject ?? "", body].join("\n\n"),
    );
    const injectionCheck = await classifyPromptInjection(guardedInput);
    if (!injectionCheck.safe) {
      console.warn("[security] Prompt injection blocked in inbound email", {
        fromEmail,
        reason: injectionCheck.reason,
      });
      return;
    }

    // Detect mode
    // agentAddress is the canonical address (without +suffix) — used for outbound from and reply-to
    const agentAddress = `${handle}@${getAgentDomain()}`;
    // The actual recipient may include +threadSuffix, so also match that
    const agentAddressWithSuffix = threadSuffix
      ? `${handle}+${threadSuffix}@${getAgentDomain()}`
      : null;
    const isAgentAddr = (addr: string) =>
      addr === agentAddress || addr === agentAddressWithSuffix;

    // Resolve broker branding once — used for outbound from-name and signature.
    const senderBrokerOrg = brokerOrg.type === "broker" ? brokerOrg : null;
    const whiteLabelingEnabled = isWhiteLabelingEnabled(senderBrokerOrg);
    const brokerLogoUrl =
      whiteLabelingEnabled && senderBrokerOrg?.iconStorageId
        ? await ctx.storage.getUrl(senderBrokerOrg.iconStorageId)
        : null;
    const brokerBranding: BrokerBranding | undefined =
      whiteLabelingEnabled && senderBrokerOrg
        ? {
            name: senderBrokerOrg.name,
            logoUrl: brokerLogoUrl,
            agentDisplayName: senderBrokerOrg.agentDisplayName,
          }
        : undefined;
    const fromHeader = `${getAgentFromName(brokerBranding)} <${agentAddress}>`;
    const agentInTo = toAddresses.some(isAgentAddr);
    const agentInCc = ccAddresses.some(isAgentAddr);
    const otherToRecipients = toAddresses.filter((a) => !isAgentAddr(a));

    const senderDomain = fromEmail.split("@")[1]?.toLowerCase();
    const companyDomains = getCompanyDomains(org, memberEmails);
    const isInternal = !!(
      senderDomain && companyDomains.includes(senderDomain)
    );

    const subjectIsForward = /^Fwd?:/i.test(data.subject ?? "");
    const bodyIsForward =
      /(?:-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:)/i.test(
        rawBody,
      );
    const isForwarded = subjectIsForward || bodyIsForward;

    const mode: EmailThreadMode =
      isInternal && isForwarded
        ? "forward"
        : agentInCc
          ? "cc"
          : isInternal && agentInTo && otherToRecipients.length > 0
            ? "cc"
            : agentInTo && otherToRecipients.length === 0
              ? "direct"
              : "unknown";

    // Threading
    const messageId = data.message_id;
    const rawHeaders = emailContent.headers;

    function getHeader(name: string): string | undefined {
      const lower = name.toLowerCase();
      if (Array.isArray(rawHeaders)) {
        return (rawHeaders as Array<{ name?: string; value?: string }>).find(
          (h) => h.name?.toLowerCase() === lower,
        )?.value;
      } else if (rawHeaders && typeof rawHeaders === "object") {
        return (
          (rawHeaders as Record<string, string>)[lower] ??
          (rawHeaders as Record<string, string>)[name]
        );
      }
      return undefined;
    }

    const inReplyTo = getHeader("In-Reply-To");
    const references = getHeader("References");
    const subject = data.subject ?? "(no subject)";

    const {
      existingThreadId,
      threadRootMode,
      matchedParentEmailMessage,
      correlatedPolicyChangeCaseId,
      correlatedPendingEmailId,
    } = await resolveInboundThreadAndPolicyChange(ctx, {
      orgId,
      fromEmail,
      subject,
      messageId,
      inReplyTo,
      references,
      threadSuffix,
      agentAddressWithSuffix,
    });

    let effectiveMode = threadRootMode ?? mode;
    if (matchedParentEmailMessage || correlatedPolicyChangeCaseId) {
      effectiveMode = "direct";
    } else if (effectiveMode === "direct" && !isInternal) {
      effectiveMode = "unknown";
    }
    // When an internal user replies to an unknown-mode thread, treat as direct.
    // This lets the agent process their instruction instead of re-sending a notification.
    if (effectiveMode === "unknown" && isInternal && existingThreadId) {
      effectiveMode = "direct";
    }

    // Store attachments in Convex file storage
    const attachmentRecords: {
      filename: string;
      contentType: string;
      size: number;
      fileId?: string;
    }[] = [];

    for (const att of attachments) {
      try {
        const blob = new Blob([new Uint8Array(att.buffer)], {
          type: att.content_type,
        });
        const fileId = await ctx.storage.store(blob);
        attachmentRecords.push({
          filename: att.filename,
          contentType: att.content_type,
          size: att.size,
          fileId,
        });
      } catch (err) {
        console.warn(`Failed to store attachment ${att.filename}:`, err);
        // Still record metadata even if storage fails
        attachmentRecords.push({
          filename: att.filename,
          contentType: att.content_type,
          size: att.size,
        });
      }
    }

    const unifiedThreadId: Id<"threads"> = await ctx.runMutation(
      internal.threads.findOrCreateForEmail,
      {
        orgId,
        userId: primaryUserId,
        subject,
        existingThreadId,
        mode: effectiveMode,
        agentDomain: getAgentDomain(),
      },
    );

    const inboundMessageId: Id<"threadMessages"> = await ctx.runMutation(
      internal.threads.insertEmailMessage,
      {
        threadId: unifiedThreadId,
        orgId,
        role: "user",
        fromEmail,
        fromName,
        toAddresses,
        ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
        subject,
        content: body,
        contentHtml: bodyHtml,
        messageId,
        resendEmailId: resendEmailId || undefined,
        attachments:
          attachmentRecords.length > 0 ? (attachmentRecords as any) : undefined,
        pendingEmailId: matchedParentEmailMessage?.pendingEmailId ?? correlatedPendingEmailId,
        policyChangeCaseId: correlatedPolicyChangeCaseId,
      },
    );

    if (correlatedPolicyChangeCaseId) {
      await ctx.runMutation(internal.policyChanges.recordBrokerEmailReplyInternal, {
        caseId: correlatedPolicyChangeCaseId,
        userId: primaryUserId,
        fromEmail,
        subject,
        content: body,
      });
    }

    // Unknown mode: notify the primary insurance contact (or first admin)
    if (effectiveMode === "unknown") {
      try {
        const notifyUserId =
          org.primaryInsuranceContactId ?? firstAdmin?.userId;
        let notifyEmail: string | undefined;
        if (notifyUserId) {
          const notifyUser = await ctx.runQuery(internal.users.getInternal, {
            id: notifyUserId,
          });
          notifyEmail = notifyUser?.email;
        }
        if (!notifyEmail) {
          throw new Error("No user email found for notification");
        }

        const notificationBody = [
          `Your Glass agent received an email it couldn't confidently classify, so it's forwarding it to you for review.`,
          ``,
          `**From:** ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
          `**Subject:** ${subject}`,
          ``,
          `---`,
          ``,
          body || "(no body)",
          ``,
          `---`,
          ``,
          `Please reply to the original sender directly if a response is needed. The agent has not sent any reply.`,
        ].join("\n");

        const signature = buildSignature(agentAddress, brokerBranding);
        const fullText = notificationBody + signature.text;

        const autoLink = (text: string) =>
          text.replace(
            /(https?:\/\/[^\s<)]+)/g,
            '<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>',
          );
        const htmlBody = notificationBody
          .split("\n\n")
          .map(
            (p) =>
              `<p style="margin:0 0 12px;line-height:1.5">${autoLink(p.replace(/\n/g, "<br>"))}</p>`,
          )
          .join("\n");
        const fullHtml = htmlBody + signature.html;

        const notifSubject = `[Glass] Help needed: ${subject}`;

        const emailPayload: Record<string, unknown> = {
          from: fromHeader,
          to: notifyEmail,
          subject: notifSubject,
          text: fullText,
          html: fullHtml,
        };

        const sendResult = await sendResendEmail(
          emailPayload as Parameters<typeof sendResendEmail>[0],
        );
        if (!sendResult.ok) {
          throw new Error(`Failed to send notification: ${sendResult.error}`);
        }
        const sentMessageId = sendResult.id;

        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: notificationBody,
          toAddresses: [notifyEmail],
          subject: notifSubject,
          responseMessageId: sentMessageId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Agent unknown-mode notification error:", message);
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: message,
          status: "error",
          error: message,
        });
      }
      return;
    }

    try {
      const scope = (await ctx.runQuery((internal as any).lib.agentScope.resolveForAction, {
        orgId,
        userId: primaryUserId,
        surface: "email",
        allowBrokerPortfolio: org.type === "broker" && isInternal && effectiveMode === "direct",
      })) as AgentScope;

      const policiesByOrg = new Map<string, { policies: any[]; quotes: any[] }>();
      await Promise.all(scope.readOrgIds.map(async (readOrgId) => {
        const docs = await ctx.runQuery(internal.policies.listAllPreviewReadableInternal, { orgId: readOrgId });
        policiesByOrg.set(String(readOrgId), {
          policies: (docs as any[]).filter((policy) => policy.documentType !== "quote"),
          quotes: (docs as any[]).filter((policy) => policy.documentType === "quote"),
        });
      }));
      const siteUrl = getClientPortalUrl();

      // Get primary user profile for name reference
      const primaryUser = await ctx.runQuery(internal.users.getInternal, {
        id: primaryUserId,
      });
      const userName = primaryUser?.name?.split(/\s+/)[0];

      const brokerIdentity = org.type === "client"
        ? await ctx.runQuery(internal.orgs.resolveBrokerIdentityInternal, {
            clientOrgId: orgId,
          })
        : null;
      const correlatedPolicyChangeCase = correlatedPolicyChangeCaseId
        ? await ctx.runQuery(internal.policyChanges.getInternal, {
            caseId: correlatedPolicyChangeCaseId,
          }) as Doc<"policyChangeCases"> | null
        : null;
      const systemPrompt = scope.mode === "broker_portfolio"
        ? buildBrokerPortfolioSystemPrompt({
            brokerName: typeof org.name === "string" ? org.name : undefined,
            brokerContext: typeof org.context === "string" ? org.context : undefined,
            userName,
            siteUrl,
          })
        : buildSystemPromptForContext({
            org: {
              name: org.name,
              context: org.context,
              coiHandling: org.coiHandling,
              broker: brokerIdentity?.brokerCompanyName
                ? {
                    name: brokerIdentity.brokerCompanyName,
                    contactName: brokerIdentity.contactName,
                    contactEmail: brokerIdentity.contactEmail,
                    contactPhone: brokerIdentity.contactPhone,
                  }
                : undefined,
            },
            mode:
              effectiveMode === "direct"
                ? "direct"
                : effectiveMode === "cc"
                  ? "cc"
                  : "forward",
            userName,
            siteUrl,
          });
      const {
        context: policyContext,
        relevantPolicyIds,
        relevantQuoteIds,
      } = await buildScopedDocumentContext(
        ctx,
        scope,
        policiesByOrg,
        subject + " " + body,
      );
      const referencedPolicySourceIds = new Set<string>([
        ...relevantPolicyIds.map(String),
        ...relevantQuoteIds.map(String),
      ]);

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(
        ctx,
        orgId,
        subject + " " + body,
      );
      const orgMemoryBlock = await buildScopedOrgMemoryContext(
        ctx,
        scope,
        subject + " " + body,
        relevantPolicyIds.map((id: string) => id),
      );
      const requirementsBlock = await buildScopedRequirementsContext(ctx, scope);

      // Build messages — include thread history for context
      const messages: ModelMessage[] = [];
      let threadMessagesForGuards: Array<{
        role?: string;
        content?: string;
        fromEmail?: string;
        toAddresses?: string[];
        ccAddresses?: string[];
        toolArtifacts?: Array<{ type: string; data: unknown }>;
      }> = [];

      if (unifiedThreadId) {
        const threadMessages = await ctx.runQuery(
          internal.threads.getEmailHistory,
          { threadId: unifiedThreadId, excludeMessageId: inboundMessageId },
        );
        threadMessagesForGuards = threadMessages;
        for (const msg of threadMessages) {
          if (msg.role === "user") {
            messages.push({
              role: "user",
              content: `Subject: ${msg.subject ?? subject}\n\nFrom: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}\n\n${msg.content}`,
            });
          } else if (msg.role === "agent") {
            const pendingSelections = Array.isArray(msg.toolArtifacts)
              ? msg.toolArtifacts
                  .filter(
                    (artifact: { type?: string; data?: unknown }) =>
                      artifact.type === "certificate_program_selection",
                  )
                  .map((artifact: { data?: unknown }) => artifact.data)
              : [];
            const selectionContext = pendingSelections
              .map((selection: unknown) =>
                formatCertificateProgramSelectionForModel(
                  selection as CertificateProgramSelection,
                ),
              )
              .join("\n\n");
            messages.push({
              role: "assistant",
              content: selectionContext
                ? `${msg.content}\n\n${selectionContext}`
                : msg.content,
            });
          }
        }
      }

      // Build the current message — include attachments if present
      const emailText = `Subject: ${subject}\n\nFrom: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}\n\n${body}`;

      // Only include supported text/PDF attachments in Claude context
      const claudeAttachments = attachments.filter((a) =>
        SUPPORTED_ATTACHMENT_TYPES.has(a.content_type),
      );

      if (claudeAttachments.length > 0) {
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "file"; data: string; mediaType: string }
          | { type: "image"; image: string; mediaType: string }
        > = [];

        for (const att of claudeAttachments) {
          if (att.content_type === "application/pdf") {
            const parsedPdfText = await tryBuildParsedPdfText({
              pdfBytes: att.buffer,
              documentId: att.filename,
              sourceKind: "attachment",
              timeoutMs: 20_000,
            });
            if (parsedPdfText) {
              contentParts.push({
                type: "text",
                text: `--- PDF attachment: ${att.filename} (LiteParse text) ---\n${parsedPdfText}\n--- End PDF attachment ---`,
              });
            } else {
              contentParts.push({
                type: "file",
                data: att.buffer.toString("base64"),
                mediaType: "application/pdf",
              });
            }
          } else if (att.content_type.startsWith("image/")) {
            contentParts.push({
              type: "image",
              image: att.buffer.toString("base64"),
              mediaType: att.content_type,
            });
          } else {
            contentParts.push({
              type: "text",
              text: `--- Attachment: ${att.filename} ---\n${att.buffer.toString("utf-8")}\n--- End attachment ---`,
            });
          }
        }

        contentParts.push({ type: "text", text: emailText });
        messages.push({ role: "user", content: contentParts });
      } else {
        messages.push({ role: "user", content: emailText });
      }

      // Build system context with optional attachment note and conversation memory
      let systemContext =
        systemPrompt +
        buildChannelInstructions({
          platform: "email",
          autoSendEmails: org.autoSendEmails === true,
          effectiveMode,
        }) +
        "\n\n" +
        policyContext +
        buildPolicyToolInstructions(10) +
        memoryContext +
        orgMemoryBlock +
        requirementsBlock;
      if (claudeAttachments.length > 0) {
        const filenames = claudeAttachments.map((a) => a.filename).join(", ");
        systemContext += `\n\nATTACHMENTS: The user's email includes ${claudeAttachments.length} attachment(s): ${filenames}. The content has been provided to you. Reference relevant information from attachments in your response when applicable.`;
      }
      if (correlatedPolicyChangeCase) {
        systemContext += `\n\nPOLICY CHANGE EMAIL REPLY:
This inbound email is a reply to a broker follow-up for policy update ${correlatedPolicyChangeCase._id}.
Follow-up status: ${correlatedPolicyChangeCase.status}.
Requested update: ${correlatedPolicyChangeCase.requestText}
${correlatedPolicyChangeCase.policyId ? `Policy ID: ${correlatedPolicyChangeCase.policyId}` : "Policy ID: not set"}

If the broker attached an endorsement or confirmation for this change, use complete_policy_change_from_endorsement with the known follow-up ID and policy ID. Do not import an endorsement as a separate policy unless it is clearly a standalone policy document. If the attachment is only a note or the policy ID is missing, summarize the broker reply and ask for the missing information.`;
      }

      // ── Build agentic tool set — the model decides whether to answer,
      // generate a COI, or extract an uploaded policy from attachments. ──
      // Map attachment filenames -> storageIds so the agent can reference them.
      const attachmentIndex: Record<
        string,
        { fileId: string; contentType: string }
      > = {};
      for (const rec of attachmentRecords) {
        if (rec.fileId) {
          attachmentIndex[rec.filename] = {
            fileId: rec.fileId,
            contentType: rec.contentType,
          };
        }
      }

      const validateThirdPartyRecipient = (recipient: string) => {
        const recipientDomain = recipient.split("@")[1]?.toLowerCase();
        if (recipientDomain && companyDomains.includes(recipientDomain)) {
          return;
        }
        const allowedRecipients = collectAllowedRecipients(
          [
            ...threadMessagesForGuards.map((m) => ({ ...m, channel: "email" })),
            {
              channel: "email",
              fromEmail,
              toAddresses,
              ccAddresses,
            },
          ],
          memberEmails,
        );
        const recipientCheck = validateEmailRecipient(
          recipient,
          allowedRecipients,
        );
        if (!recipientCheck.allowed) {
          console.warn("[security] Inbound email recipient blocked", {
            inboundMessageId,
            recipient,
            reason: recipientCheck.reason,
          });
          throw new Error(recipientCheck.reason!);
        }
      };
      let toolSentEmail: ToolSentEmail | null = null;
      const generatedCoiAttachments: EmailAttachmentMeta[] = [];
      const emailToolArtifacts: Array<{ type: string; data: unknown }> = [];
      const certificateProgramSelectionArtifacts: CertificateProgramSelection[] = [];
      const availableEmailAttachments = attachmentRecords
        .filter(
          (rec): rec is typeof rec & { fileId: Id<"_storage"> } =>
            !!rec.fileId,
        )
        .map((rec) => ({
          filename: rec.filename,
          contentType: rec.contentType,
          size: rec.size,
          fileId: rec.fileId,
        }));
      const availableFileIds = new Set(
        availableEmailAttachments.map((attachment) => String(attachment.fileId)),
      );
      const brokerDirectedEmailRequest = isBrokerDirectedEmailRequest(
        [subject ?? "", body].join("\n\n"),
      );
      const brokerRecipientEmail = brokerDirectedEmailRequest
        ? brokerIdentity?.contactEmail
        : undefined;
      const brokerRecipientName = brokerDirectedEmailRequest
        ? brokerIdentity?.contactName ?? brokerIdentity?.brokerCompanyName
        : undefined;

      const emailTools = {
        ...buildAgentToolExecutors(ctx, {
          surface: "email",
          orgId,
          userId: primaryUserId,
          scope,
          org,
          threadId: unifiedThreadId,
          defaultPolicyChangeCaseId: correlatedPolicyChangeCaseId,
          availableFileIds,
          onPolicyReferenced: (policyId) => {
            referencedPolicySourceIds.add(String(policyId));
          },
          onResponseAttachment: (attachment) => {
            if (!attachment.fileId) return;
            generatedCoiAttachments.push({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
              fileId: attachment.fileId,
            });
          },
          onToolArtifact: (artifact) => {
            emailToolArtifacts.push(artifact);
            if (artifact.type === "certificate_program_selection") {
              certificateProgramSelectionArtifacts.push(
                artifact.data as CertificateProgramSelection,
              );
            }
          },
        }),
        ...(isInternal && effectiveMode === "direct"
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId,
                userId: primaryUserId,
                threadId: unifiedThreadId,
                channel: "email",
                fromHeader,
                agentAddress,
                brokerBranding,
                senderEmail: fromEmail,
                defaultTo: brokerDirectedEmailRequest
                  ? brokerRecipientEmail
                  : fromEmail,
                defaultRecipientName: brokerDirectedEmailRequest
                  ? brokerRecipientName
                  : fromName,
                requireKnownRecipient: brokerDirectedEmailRequest,
                missingRecipientMessage:
                  "No broker contact email is set for this organization. Add the broker contact in Settings, or provide the broker's email address before I draft or send this.",
                unknownRecipientMessage:
                  "I cannot use that broker recipient because it is not the configured broker contact in Glass. Add the broker contact in Settings, or provide the correct broker email address explicitly.",
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false
                    ? [fromEmail]
                    : undefined,
                subjectHint: subject,
                inReplyTo: messageId,
                references: messageId,
                allowedRecipients: [
                  ...new Set(
                    [
                      ...collectAllowedRecipients(
                        [
                          ...threadMessagesForGuards.map((m) => ({
                            ...m,
                            channel: "email",
                          })),
                          {
                            channel: "email",
                            fromEmail,
                            toAddresses,
                            ccAddresses,
                          },
                        ],
                        memberEmails,
                      ),
                      ...memberEmails,
                      brokerIdentity?.contactEmail,
                    ]
                      .filter(Boolean)
                      .map((email) => String(email).toLowerCase()),
                  ),
                ],
                availableAttachments: availableEmailAttachments,
                referencedPolicyIds:
                  referencedPolicySourceIds.size > 0
                    ? ([...referencedPolicySourceIds] as Id<"policies">[])
                    : undefined,
                referencedQuoteIds:
                  relevantQuoteIds.length > 0
                    ? (relevantQuoteIds as Id<"policies">[])
                    : undefined,
                autoSendEmails: brokerDirectedEmailRequest
                  ? false
                  : org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                autoGenerateCoi: org.autoGenerateCoi,
                coiHandling: org.coiHandling,
                conversationContext: [
                  `Inbound email from ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
                  `Subject: ${subject}`,
                  body,
                ].join("\n\n"),
                onResult: (result: EmailSubagentResult) => {
                  if (result.status === "sent" || result.status === "pending") {
                    toolSentEmail = {
                      responseBody: result.responseBody,
                      responseTo: result.responseTo ?? "",
                      responseCc: result.responseCc,
                      responseMessageId: result.responseMessageId,
                    };
                  }
                },
              }),
            }
          : {}),
        ...(isInternal && effectiveMode === "direct"
          ? {
              create_imessage_group_chat: {
                ...createImessageGroupChat,
                execute: async (params: {
                  recipients: string[];
                  openingMessage: string;
                  title?: string;
                  confirmed: boolean;
                }) => {
                  if (!params.confirmed) {
                    return "Ask the user to confirm before creating a new iMessage group chat.";
                  }
                  return await ctx.runAction(
                    internal.actions.createOutboundImessageGroup.createOutboundImessageGroupInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      recipients: params.recipients,
                      openingMessage: params.openingMessage,
                      title: params.title,
                    },
                  );
                },
              },
              search_connected_email: {
                ...searchConnectedEmail,
                execute: async (params: {
                  query?: string;
                  mailbox?: string;
                  sinceDays?: number;
                  dateFrom?: string;
                  dateTo?: string;
                  limit?: number;
                }) =>
                  await ctx.runAction(internal.actions.connectedEmail.searchInternal, {
                    orgId,
                    userId: primaryUserId,
                    query: params.query,
                    mailbox: params.mailbox,
                    sinceDays: params.sinceDays,
                    dateFrom: params.dateFrom,
                    dateTo: params.dateTo,
                    limit: params.limit,
                  }),
              },
              read_connected_email: {
                ...readConnectedEmail,
                execute: async (params: { emailRef: string }) =>
                  await ctx.runAction(internal.actions.connectedEmail.readInternal, {
                    orgId,
                    userId: primaryUserId,
                    emailRef: params.emailRef,
                  }),
              },
              read_connected_email_attachment: {
                ...readConnectedEmailAttachment,
                execute: async (params: { emailRef: string; filename: string }) =>
                  await ctx.runAction(internal.actions.connectedEmail.readAttachmentInternal, {
                    orgId,
                    userId: primaryUserId,
                    emailRef: params.emailRef,
                    filename: params.filename,
                  }),
              },
              import_connected_email_policy_attachments: {
                ...importConnectedEmailPolicyAttachments,
                execute: async (params: { emailRef: string; filenames?: string[] }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail.importPolicyAttachmentsInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                      filenames: params.filenames,
                    },
                  ),
              },
              import_connected_email_requirement_attachments: {
                ...importConnectedEmailRequirementAttachments,
                execute: async (params: {
                  emailRef: string;
                  filenames?: string[];
                  sourceType?: "lease_agreement" | "client_contract" | "vendor_requirements" | "other";
                  appliesTo?: "vendors" | "own_org" | "both";
                }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail.importRequirementAttachmentsInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                      filenames: params.filenames,
                      sourceType: params.sourceType,
                      appliesTo: params.appliesTo,
                    },
                  ),
              },
              send_connected_vendor_invite: {
                ...sendConnectedVendorInvite,
                execute: async (params: {
                  vendorEmail: string;
                  relationshipLabel?: string;
                  note?: string;
                }) =>
                  await ctx.runAction(internal.connectedOrgs.requestVendorAccessByEmailInternal, {
                    clientOrgId: orgId,
                    requestedByUserId: primaryUserId,
                    vendorEmail: params.vendorEmail,
                    relationshipLabel: params.relationshipLabel,
                    note: params.note,
                  }),
              },
              coordinate_mailbox_task: {
                ...coordinateMailboxTask,
                execute: async (params: { task: string }) =>
                  await ctx.runAction(internal.actions.mailboxCoordinator.runInternal, {
                    orgId,
                    userId: primaryUserId,
                    task: params.task,
                  }),
              },
              web_research: {
                ...webResearch,
                execute: async (params: WebRetrievalInput) => {
                  const result = await runWebRetrieval(ctx, orgId, params);
                  if (!result.text) {
                    return {
                      status: "unavailable",
                      attempts: result.attempts,
                      warnings: result.warnings,
                    };
                  }
                  return {
                    status: "ok",
                    provider: result.provider,
                    text: result.text,
                    sources: result.sources,
                    warnings: result.warnings,
                  };
                },
              },
            }
          : {}),
        extract_policy_attachment: {
          ...extractPolicyAttachment,
          execute: async (params: {
            files: Array<{ storageId: string; fileName: string }>;
          }) => {
            if (!params.files || params.files.length === 0) {
              return "No files provided.";
            }
            // Validate every storageId belongs to one of this email's attachments
            for (const f of params.files) {
              const matched = Object.entries(attachmentIndex).find(
                ([, v]) => v.fileId === f.storageId,
              );
              if (!matched) {
                return `Storage ID ${f.storageId} does not match any attachment on this email.`;
              }
            }
            try {
              const result = await ctx.runAction(
                internal.actions.extractFromUpload.extractFromUploadInternal,
                {
                  files: params.files.map((f) => ({
                    fileId: f.storageId as Id<"_storage">,
                    fileName: f.fileName,
                  })),
                  orgId,
                  userId: primaryUserId,
                },
              );
              if ("error" in result)
                return `Extraction failed: ${result.error}`;
              const names = params.files.map((f) => f.fileName).join(", ");
              return `Extraction started for ${params.files.length} file(s) [${names}] as a single policy. Policy ID: ${result.policyId}. It will appear in the policy library once processing completes.`;
            } catch (err) {
              return `Failed to start extraction: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        },
      };

      // Tell the agent about available attachments and their storage IDs.
      let attachmentToolHint = "";
      if (claudeAttachments.length > 0) {
        const pdfAttachments = claudeAttachments
          .filter((a) => a.content_type === "application/pdf")
          .map((a) => {
            const rec = attachmentRecords.find(
              (r) => r.filename === a.filename,
            );
            return rec?.fileId
              ? `- "${a.filename}" (storageId: ${rec.fileId})`
              : null;
          })
          .filter(Boolean);
        if (pdfAttachments.length > 0) {
          attachmentToolHint = correlatedPolicyChangeCase
            ? `\n\nATTACHMENT TOOLS:
This email is linked to broker follow-up ${correlatedPolicyChangeCase._id}. If any attached PDF is an endorsement or confirmation of the requested change, call complete_policy_change_from_endorsement with caseId "${correlatedPolicyChangeCase._id}"${correlatedPolicyChangeCase.policyId ? ` and policyId "${correlatedPolicyChangeCase.policyId}"` : ""}. Only use extract_policy_attachment if the PDF is clearly a new standalone policy, quote, binder, or COI that should be added to the library separately.

PDF ATTACHMENT MANIFEST (storageId -> fileName):
${pdfAttachments.join("\n")}`
            : `\n\nATTACHMENT TOOLS:
If any attached PDF appears to be a policy, declarations page, quote, binder, COI, or other insurance document that should be added to the organization's policy library, call the extract_policy_attachment tool. PDFs are also provided inline so you may read them to answer questions.

PDF ATTACHMENT MANIFEST (storageId -> fileName):
${pdfAttachments.join("\n")}

IMPORTANT GROUPING RULE: A real-world policy commonly arrives as multiple PDFs in the SAME email (for example: COI + declarations + full policy wording). If multiple PDFs in this email describe the SAME policy, call extract_policy_attachment ONCE with ALL of them in the files array — they will be combined into a single policy record. Only make separate extract_policy_attachment calls when the attachments clearly belong to DIFFERENT policies.`;
        }
      }

      systemContext += attachmentToolHint;
      const currentDraftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: unifiedThreadId, orgId },
      ) as Array<Doc<"pendingEmails">>;
      if (currentDraftEmails.length > 0) {
        systemContext += `\n\nCURRENT EMAIL DRAFTS:\n${buildEmailDraftTextSummary(currentDraftEmails, {
          sampleSize: Math.min(3, currentDraftEmails.length),
          includeIds: false,
          commands: "chat",
        })}\n\nFor email replies about multiple drafts, show a short sample first and ask whether the user wants more detail instead of dumping every draft.`;
      }
      systemContext += `\n\nYou have tools to look up policies, search policy source evidence and document outlines, compare coverages, check compliance requirements, look up connected vendors, inspect vendor policies, inspect requirement-by-requirement vendor compliance, save notes, generate COIs, and extract uploaded policy attachments. Use them as needed before answering. Decide yourself whether the email requires answering a question, generating a COI, and/or extracting an attached policy — you may do more than one.`;

      let responseBody: string;
      const emailCommandText = stripQuotedText(body).trim();
      const shortEmailCommand = emailCommandText.length < 120;
      if (
        currentDraftEmails.length > 0 &&
        shortEmailCommand &&
        isShowMoreEmailDraftIntent(emailCommandText)
      ) {
        responseBody = buildEmailDraftTextSummary(currentDraftEmails, {
          sampleSize: currentDraftEmails.length,
          includeBodyPreview: true,
          commands: "chat",
        });
      } else if (
        currentDraftEmails.length > 0 &&
        shortEmailCommand &&
        isSendAllEmailDraftsIntent(emailCommandText)
      ) {
        let sentCount = 0;
        const failed: string[] = [];
        for (const draftEmail of currentDraftEmails) {
          try {
            await ctx.runAction(
              internal.actions.sendPendingEmail.sendDraftInternal,
              { id: draftEmail._id },
            );
            sentCount++;
          } catch (err) {
            failed.push(err instanceof Error ? err.message : String(err));
          }
        }
        responseBody = failed.length === 0
          ? sentCount === 1
            ? "Sent the draft email."
            : `Sent ${sentCount} draft emails.`
          : `Sent ${sentCount} draft email${sentCount === 1 ? "" : "s"}; ${failed.length} failed. ${failed[0]}`;
      } else {
        // Agentic loop — the model decides tools (COI, policy extraction, Q&A)
        const result = await generateText({
          model: await getModelForOrg(ctx, orgId, "email_reply"),
          providerOptions: getProviderOptionsForTask("email_reply"),
          maxOutputTokens: 2048,
          system: systemContext,
          messages,
          tools: emailTools,
          stopWhen: stepCountIs(10),
        });
        responseBody = result.text;
      }

      const sentByTool = toolSentEmail as ToolSentEmail | null;
      if (sentByTool) {
        return;
      }

      // ── Detect "Sending email to..." pattern for third-party sends ──
      const sendMatch = responseBody.match(
        /\*?\*?Sending email to (.+?)\.\.\.\*?\*?\s*\n([\s\S]+)$/i,
      );
      if (isInternal && sendMatch) {
        try {
          const emailBody = sendMatch[2].trim();
          const recipientHint = sendMatch[1].trim();
          const hintEmailMatch = recipientHint.match(/[\w.+-]+@[\w.-]+\.\w+/);
          const thirdPartyEmail = hintEmailMatch?.[0];
          if (!thirdPartyEmail)
            throw new Error("No recipient email found in agent output");
          validateThirdPartyRecipient(thirdPartyEmail);

          const stripMd = (text: string) => {
            let r = text;
            r = r.replace(/^#{1,6}\s+(.+)$/gm, "$1");
            r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
            r = r.replace(/\*\*(.+?)\*\*/g, "$1");
            r = r.replace(/\*(.+?)\*/g, "$1");
            return r;
          };
          const mdToHtml = (text: string) => {
            const ls = 'style="color:#2563eb;text-decoration:underline"';
            let r = text;
            r = r.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
            r = r.replace(
              /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
              `<a href="$2" ${ls}>$1</a>`,
            );
            r = r.replace(
              /(?<!href=")(https?:\/\/[^\s<)]+)/g,
              `<a href="$1" ${ls}>$1</a>`,
            );
            r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
            r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
            return r;
          };

          const sig = buildSignature(agentAddress, brokerBranding);
          const plainText = stripMd(emailBody) + sig.text;
          const htmlBody =
            emailBody
              .split("\n\n")
              .map(
                (p) =>
                  `<p style="margin:0 0 12px;line-height:1.5">${mdToHtml(p.replace(/\n/g, "<br>"))}</p>`,
              )
              .join("\n") + sig.html;

          const sendSubject = subject.replace(
            /^\[Glass\]\s*Help needed:\s*/i,
            "",
          );
          const replySub = sendSubject.startsWith("Re:")
            ? sendSubject
            : `Re: ${sendSubject}`;

          const sendCc = [fromEmail]; // CC the internal user who gave the instruction

          const sendPayload: Record<string, unknown> = {
            from: fromHeader,
            to: thirdPartyEmail,
            cc: sendCc,
            subject: replySub,
            text: plainText,
            html: htmlBody,
          };
          if (messageId) {
            sendPayload.headers = {
              "In-Reply-To": messageId,
              References: messageId,
            };
          }

          // Check send delay setting
          const sendDelay = org?.emailSendDelay ?? 5; // default 5 seconds

          if (sendDelay > 0 && unifiedThreadId) {
            // Queue email with delay
            const scheduledSendTime = Date.now() + sendDelay * 1000;
            const pendingEmailId = await ctx.runMutation(
              internal.pendingEmails.create,
              {
                orgId,
                threadId: unifiedThreadId,
                emailPayload: JSON.stringify(sendPayload),
                scheduledSendTime,
                recipientEmail: thirdPartyEmail,
                ccAddresses: sendCc,
                subject: replySub,
                emailBody,
                attachments:
                  generatedCoiAttachments.length > 0
                    ? generatedCoiAttachments
                    : undefined,
                referencedPolicyIds:
                  referencedPolicySourceIds.size > 0
                    ? ([...referencedPolicySourceIds] as Id<"policies">[])
                    : undefined,
                referencedQuoteIds:
                  relevantQuoteIds.length > 0
                    ? (relevantQuoteIds as Id<"policies">[])
                    : undefined,
              },
            );

            // Schedule the actual send
            await ctx.scheduler.runAfter(
              sendDelay * 1000,
              internal.actions.sendPendingEmail.sendPending,
              { id: pendingEmailId },
            );
          } else {
            // Send immediately (delay = 0 or no unified thread)
            if (generatedCoiAttachments.length > 0) {
              sendPayload.attachments = await toResendAttachments(
                ctx,
                generatedCoiAttachments,
              );
            }
            const sendOutcome = await sendResendEmail(
              sendPayload as Parameters<typeof sendResendEmail>[0],
            );
            if (!sendOutcome.ok)
              throw new Error(`Failed to send email: ${sendOutcome.error}`);
            const sentMsgId = sendOutcome.id;

            await ctx.runMutation(internal.threads.insertEmailMessage, {
              threadId: unifiedThreadId,
              orgId,
              role: "agent",
              content: emailBody,
              toAddresses: [thirdPartyEmail],
              ccAddresses: sendCc,
              subject: replySub,
              responseMessageId: sentMsgId,
              referencedPolicyIds:
                referencedPolicySourceIds.size > 0
                  ? ([...referencedPolicySourceIds] as Id<"policies">[])
                  : undefined,
              referencedQuoteIds:
                relevantQuoteIds.length > 0
                  ? (relevantQuoteIds as Id<"policies">[])
                  : undefined,
            });
          }
          return; // done — third-party send handled
        } catch (err) {
          console.error("Third-party email send failed:", err);
          // Fall through to normal reply with the agent's response
        }
      }

      // Domain guard: strip internal URLs from customer-facing replies
      if (effectiveMode === "cc" || effectiveMode === "forward") {
        const escapedSiteUrl = siteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        responseBody = responseBody.replace(
          new RegExp(`\\[([^\\]]+)\\]\\(${escapedSiteUrl}[^)]*\\)`, "g"),
          "$1",
        );
        responseBody = responseBody.replace(
          new RegExp(`${escapedSiteUrl}[^\\s)]*`, "g"),
          "[internal link removed]",
        );
      }

      // Build reply with signature
      const stripMarkdown = (text: string) => {
        let result = text;
        result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
        result = result.replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          "$1 ($2)",
        );
        result = result.replace(/\*\*(.+?)\*\*/g, "$1");
        result = result.replace(/\*(.+?)\*/g, "$1");
        return result;
      };
      const plainTextBody = stripMarkdown(responseBody);
      const signature = buildSignature(agentAddress, brokerBranding);
      const fullReplyText = plainTextBody + signature.text;

      const linkStyle = 'style="color:#2563eb;text-decoration:underline"';
      const markdownToHtml = (text: string) => {
        let result = text;
        result = result.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
        result = result.replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          `<a href="$2" ${linkStyle}>$1</a>`,
        );
        result = result.replace(
          /(?<!href=")(https?:\/\/[^\s<)]+)/g,
          `<a href="$1" ${linkStyle}>$1</a>`,
        );
        result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
        return result;
      };
      const bodyHtmlContent = responseBody
        .split("\n\n")
        .map(
          (p) =>
            `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`,
        )
        .join("\n");
      const fullReplyHtml = bodyHtmlContent + signature.html;

      // Determine reply recipients
      const primaryUserEmail = primaryUser?.email;
      let replyTo: string;
      let replyCc: string[] = [];

      if (effectiveMode === "forward") {
        const originalSender = extractForwardedSender(rawBody);
        replyTo = originalSender ?? fromEmail;
        replyCc = [fromEmail];
        if (replyTo === fromEmail) {
          replyCc = [];
        }
      } else if (effectiveMode === "cc") {
        replyTo = fromEmail;
        replyCc = [...toAddresses, ...ccAddresses].filter(
          (a) => !isAgentAddr(a) && a !== fromEmail,
        );
      } else {
        replyTo = fromEmail;
      }

      // Ensure user is CC'd on cc/forward replies
      if (
        (effectiveMode === "cc" || effectiveMode === "forward") &&
        primaryUserEmail
      ) {
        if (
          replyTo !== primaryUserEmail &&
          !replyCc.includes(primaryUserEmail)
        ) {
          replyCc.push(primaryUserEmail);
        }
      }

      // Send reply via Resend
      const cleanSubject =
        effectiveMode === "forward"
          ? subject.replace(/^Fwd?:\s*/i, "")
          : subject;
      const replySubject = cleanSubject.startsWith("Re:")
        ? cleanSubject
        : `Re: ${cleanSubject}`;

      const emailPayload: Record<string, unknown> = {
        from: fromHeader,
        to: replyTo,
        subject: replySubject,
        text: fullReplyText,
        html: fullReplyHtml,
      };
      if (generatedCoiAttachments.length > 0) {
        emailPayload.attachments = await toResendAttachments(
          ctx,
          generatedCoiAttachments,
        );
      }

      if (replyCc.length > 0) {
        emailPayload.cc = replyCc;
      }

      // Threading headers
      const replyHeaders: Record<string, string> = {};
      if (effectiveMode === "forward") {
        const xFwd = getHeader("X-Forwarded-Message-Id");
        const refs = getHeader("References");
        const originalMessageId =
          xFwd ||
          (refs ? refs.trim().split(/\s+/).pop() : undefined) ||
          messageId;
        if (originalMessageId) {
          replyHeaders["In-Reply-To"] = originalMessageId;
          replyHeaders["References"] = refs
            ? `${refs} ${originalMessageId}`
            : originalMessageId;
        }
      } else if (messageId) {
        replyHeaders["In-Reply-To"] = messageId;
        replyHeaders["References"] = messageId;
      }
      if (Object.keys(replyHeaders).length > 0) {
        emailPayload.headers = replyHeaders;
      }

      const sendResult = await sendResendEmail(
        emailPayload as Parameters<typeof sendResendEmail>[0],
      );
      if (!sendResult.ok) {
        throw new Error(`Failed to send reply: ${sendResult.error}`);
      }
      const sentMessageId = sendResult.id;

      await ctx.runMutation(internal.threads.insertEmailMessage, {
        threadId: unifiedThreadId,
        orgId,
        role: "agent",
        content: responseBody,
        toAddresses: [replyTo],
        ccAddresses: replyCc.length > 0 ? replyCc : undefined,
        responseMessageId: sentMessageId,
        referencedPolicyIds:
          referencedPolicySourceIds.size > 0
            ? ([...referencedPolicySourceIds] as Id<"policies">[])
            : undefined,
        referencedQuoteIds:
          relevantQuoteIds.length > 0
            ? (relevantQuoteIds as Id<"policies">[])
            : undefined,
        attachments:
          generatedCoiAttachments.length > 0
            ? generatedCoiAttachments
            : undefined,
        toolArtifacts:
          emailToolArtifacts.length > 0
            ? emailToolArtifacts
            : certificateProgramSelectionArtifacts.length > 0
              ? certificateProgramSelectionArtifacts.map((selection) => ({
                  type: "certificate_program_selection",
                  data: selection,
                }))
              : undefined,
        policyChangeCaseId: correlatedPolicyChangeCaseId,
      });

      // ── Phase E: extract durable facts from this email exchange into orgMemory ──
      try {
        const memoryExtraction = await generateText({
          model: haikuModel,
          maxOutputTokens: 600,
          system: `You extract durable facts, preferences, risk notes, or observations about an organization from a single email exchange to persist across conversations.
Output a strict JSON array of up to 5 items, each: {"type": "fact"|"preference"|"risk_note"|"observation", "content": string}.
Only include items worth remembering long-term (company details, operational facts, stated preferences, noted risks, decisions made). Skip pleasantries, one-off questions, and anything ephemeral. If nothing is worth saving, output [].
Output ONLY the JSON array — no prose, no code fences.`,
          messages: [
            {
              role: "user",
              content: `INBOUND EMAIL (from ${fromEmail}):\nSubject: ${subject}\n\n${body}\n\n---\nAGENT REPLY:\n${responseBody}`,
            },
          ],
        });
        let parsed: Array<{ type: string; content: string }> = [];
        try {
          const cleaned = memoryExtraction.text
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "");
          const arr = JSON.parse(cleaned);
          if (Array.isArray(arr)) parsed = arr;
        } catch {
          // ignore parse failures
        }
        const allowedTypes = new Set([
          "fact",
          "preference",
          "risk_note",
          "observation",
        ]);
        const items = parsed
          .filter(
            (it) =>
              it && typeof it.content === "string" && allowedTypes.has(it.type),
          )
          .slice(0, 5)
          .map((it) => ({
            orgId,
            type: it.type as
              | "fact"
              | "preference"
              | "risk_note"
              | "observation",
            content: it.content.trim(),
            source: "email" as const,
          }))
          .filter((it) => it.content.length > 0);
        if (items.length > 0) {
          await ctx.runMutation(internal.orgMemory.bulkInsert, { items });
        }
      } catch (err) {
        console.warn("orgMemory extraction (email) failed:", err);
      }

      // Audit: log agent references to policies
      for (const pId of relevantPolicyIds) {
        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId: pId as Id<"policies">,
          userId: primaryUserId,
          orgId,
          action: "agent_referenced",
          detail: subject,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Agent processing error:", message);
      try {
        const failureSubject = subject.startsWith("Re:")
          ? subject
          : `Re: ${subject}`;
        const failureHtml = `<p style="margin:0 0 12px;line-height:1.5">${FATAL_ACTION_FAILED_MESSAGE}</p>`;
        const failurePayload: Record<string, unknown> = {
          from: fromHeader,
          to: fromEmail,
          subject: failureSubject,
          text: FATAL_ACTION_FAILED_MESSAGE,
          html: failureHtml,
        };
        if (messageId) {
          failurePayload.headers = {
            "In-Reply-To": messageId,
            References: messageId,
          };
        }
        const sendResult = await sendResendEmail(
          failurePayload as Parameters<typeof sendResendEmail>[0],
        );
        const sentMessageId = sendResult.ok ? sendResult.id : undefined;
        if (!sendResult.ok) {
          console.warn("Failed to send agent failure email:", sendResult.error);
        }
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: FATAL_ACTION_FAILED_MESSAGE,
          toAddresses: [fromEmail],
          subject: failureSubject,
          responseMessageId: sentMessageId,
        });
      } catch (notifyError) {
        console.warn(
          "Failed to record/send agent failure response:",
          notifyError,
        );
      }
    }
  },
});
