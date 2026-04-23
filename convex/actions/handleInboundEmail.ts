"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import { getModel } from "../lib/models";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  saveNote,
  generateCoi as generateCoiTool,
  extractPolicyAttachment,
} from "../lib/chatTools";
import { Webhook } from "svix";
import { buildAgentSystemPrompt, buildDocumentContext, buildConversationMemoryContext, type AgentContext } from "../lib/agentPrompts";
import { Id } from "../_generated/dataModel";
import { sendResendEmail, getAgentDomain } from "../lib/resend";

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "zoho.com", "mail.com",
  "ymail.com", "gmx.com", "gmx.net",
]);

function getCompanyDomains(org: { website?: string }, memberEmails: string[]): string[] {
  const domains: string[] = [];
  if (org.website) {
    try {
      const hostname = new URL(org.website).hostname.replace(/^www\./, "");
      if (!CONSUMER_DOMAINS.has(hostname)) domains.push(hostname);
    } catch { /* ignore invalid URLs */ }
  }
  for (const email of memberEmails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !CONSUMER_DOMAINS.has(domain) && !domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return domains;
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
  return raw.split(",").map((a) => extractEmailAddress(a.trim())).filter(Boolean);
}

function findAgentHandle(addresses: string[]): { handle: string; threadSuffix?: string } | null {
  for (const addr of addresses) {
    if (addr.endsWith(`@${getAgentDomain()}`)) {
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
  cleaned = cleaned.replace(/\r?\n\s*-{5,}\s*Forwarded message\s*-{5,}[\s\S]*$/, "");
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

function buildSignature(agentEmail: string, broker?: BrokerBranding): { text: string; html: string } {
  const poweredByUrl = process.env.SITE_URL ?? "https://glass.claritylabs.dev";
  const hasBroker = !!(broker?.name || broker?.agentDisplayName);
  const agentName = getAgentFromName(broker);

  const text = [
    "",
    "—",
    agentName,
    agentEmail,
    "",
    `powered by Glass from Clarity Labs — ${poweredByUrl}`,
  ].join("\n");

  const logoHtml = hasBroker && broker?.logoUrl
    ? `<img src="${broker.logoUrl}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:4px;margin-right:8px;object-fit:cover;border:0;" />`
    : `<span style="color:#A0D2FA;font-size:15px;font-family:'Segoe UI Symbol','Apple Symbols',sans-serif;margin-right:6px">&#x2733;&#xFE0E;</span>`;

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">—</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${agentName}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    `<p style="font-size:12px;margin:12px 0 0"><a href="${poweredByUrl}" style="color:#A0D2FA;text-decoration:none">powered by Glass from Clarity Labs</a></p>`,
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

async function fetchAttachments(emailId: string): Promise<DownloadedAttachment[]> {
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

async function fetchEmailContent(emailId: string): Promise<ReceivedEmailContent> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
    },
  });
  if (!res.ok) {
    console.warn(`Failed to fetch from receiving API (${res.status}), trying sent emails API...`);
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
      console.warn("RESEND_WEBHOOK_SECRET not set — skipping signature verification");
    }

    const webhook: WebhookPayload = JSON.parse(args.payload);
    const data = webhook.data ?? webhook;

    // Dedup
    const resendEmailId = data.email_id;
    if (resendEmailId) {
      const isDuplicate = await ctx.runQuery(
        internal.agentConversations.checkDuplicate,
        { resendEmailId },
      );
      if (isDuplicate) {
        console.log("Duplicate webhook — already processed email_id:", resendEmailId);
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
    if (fromEmail.endsWith(`@${getAgentDomain()}`)) {
      console.log("Loop prevention: ignoring email from agent domain", fromEmail);
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
    const orgMembers = await ctx.runQuery(internal.orgs.getMembersInternal, { orgId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memberEmails = orgMembers
      .map((m: any) => m.user?.email)
      .filter(Boolean) as string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstAdmin = orgMembers.find((m: any) => m.role === "admin");

    // Match sender to an org member by email — so the right user is attributed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const senderMember = orgMembers.find(
      (m: any) => m.user?.email?.toLowerCase() === fromEmail.toLowerCase(),
    );
    const primaryUserId = senderMember?.userId
      ?? org.primaryInsuranceContactId
      ?? firstAdmin?.userId;

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

    // Detect mode
    // agentAddress is the canonical address (without +suffix) — used for outbound from and reply-to
    const agentAddress = `${handle}@${getAgentDomain()}`;
    // The actual recipient may include +threadSuffix, so also match that
    const agentAddressWithSuffix = threadSuffix ? `${handle}+${threadSuffix}@${getAgentDomain()}` : null;
    const isAgentAddr = (addr: string) => addr === agentAddress || addr === agentAddressWithSuffix;

    // Resolve broker branding once — used for outbound from-name and signature.
    const brokerLogoUrl = brokerOrg.iconStorageId
      ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
      : null;
    const brokerBranding: BrokerBranding = {
      name: brokerOrg.name,
      logoUrl: brokerLogoUrl,
      agentDisplayName: brokerOrg.agentDisplayName,
    };
    const fromHeader = `${getAgentFromName(brokerBranding)} <${agentAddress}>`;
    const agentInTo = toAddresses.some(isAgentAddr);
    const agentInCc = ccAddresses.some(isAgentAddr);
    const otherToRecipients = toAddresses.filter((a) => !isAgentAddr(a));

    const senderDomain = fromEmail.split("@")[1]?.toLowerCase();
    const companyDomains = getCompanyDomains(org, memberEmails);
    const isInternal = !!(senderDomain && companyDomains.includes(senderDomain));

    const subjectIsForward = /^Fwd?:/i.test(data.subject ?? "");
    const bodyIsForward = /(?:-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:)/i.test(rawBody);
    const isForwarded = subjectIsForward || bodyIsForward;

    const mode: "direct" | "cc" | "forward" | "unknown" =
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
        return (rawHeaders as Record<string, string>)[lower] ?? (rawHeaders as Record<string, string>)[name];
      }
      return undefined;
    }

    const inReplyTo = getHeader("In-Reply-To");
    const subject = data.subject ?? "(no subject)";

    // Resolve thread
    let threadId: Id<"agentConversations"> | undefined;
    let threadRootMode: "direct" | "cc" | "forward" | "unknown" | undefined;
    // Track unified thread found via +suffix routing (may exist without legacy link)
    let preResolvedUnifiedThreadId: Id<"threads"> | undefined;

    // First: try resolving via +threadSuffix in the recipient address
    // This is the most reliable method — the threadEmail is unique per thread
    if (threadSuffix && agentAddressWithSuffix) {
      const unifiedThread = await ctx.runQuery(
        internal.threads.findByEmail,
        { threadEmail: agentAddressWithSuffix },
      );
      if (unifiedThread) {
        preResolvedUnifiedThreadId = unifiedThread._id;
        if (unifiedThread.legacyConversationId) {
          threadId = unifiedThread.legacyConversationId;
          const legacyRoot = await ctx.runQuery(
            internal.agentConversations.getById,
            { id: unifiedThread.legacyConversationId },
          );
          threadRootMode = legacyRoot?.mode;
        }
        // If no legacyConversationId, this is a chat-originated thread.
        // threadId stays undefined — we'll create a legacy conversation below
        // but the unified thread is already resolved.
      }
    }

    // Fallback: In-Reply-To header matching
    if (!threadId && inReplyTo) {
      const parent = await ctx.runQuery(
        internal.agentConversations.findByMessageId,
        { messageId: inReplyTo },
      );
      if (parent) {
        threadId = parent.threadId ?? parent._id;
        threadRootMode = parent.threadId
          ? (await ctx.runQuery(internal.agentConversations.getById, { id: parent.threadId }))?.mode
          : parent.mode;
      }
    }

    if (!threadId) {
      const subjectMatch = await ctx.runQuery(
        internal.agentConversations.findThreadBySubject,
        { orgId, subject, fromEmail },
      );
      if (subjectMatch) {
        threadId = subjectMatch.threadId ?? subjectMatch._id;
        threadRootMode = subjectMatch.threadId
          ? (await ctx.runQuery(internal.agentConversations.getById, { id: subjectMatch.threadId }))?.mode
          : subjectMatch.mode;
      }
    }

    let effectiveMode = threadRootMode ?? mode;
    if (effectiveMode === "direct" && !isInternal) {
      effectiveMode = "unknown";
    }
    // When an internal user replies to an unknown-mode thread, treat as direct.
    // This lets the agent process their instruction instead of re-sending a notification.
    if (effectiveMode === "unknown" && isInternal && threadId) {
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
        const blob = new Blob([new Uint8Array(att.buffer)], { type: att.content_type });
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

    // Create conversation record
    const conversationId = await ctx.runMutation(
      internal.agentConversations.insertInbound,
      {
        userId: primaryUserId,
        orgId,
        fromEmail,
        fromName,
        toAddresses,
        ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
        subject,
        body,
        bodyHtml,
        inReplyTo,
        messageId,
        mode: effectiveMode,
        resendEmailId: resendEmailId || undefined,
        threadId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attachments: attachmentRecords.length > 0 ? attachmentRecords as any : undefined,
      },
    );

    // Mark processing
    await ctx.runMutation(internal.agentConversations.markProcessing, {
      id: conversationId,
    });

    // ── Dual-write: unified threads table ──
    let unifiedThreadId: Id<"threads"> | undefined = preResolvedUnifiedThreadId;
    try {
      if (!unifiedThreadId) {
        unifiedThreadId = await ctx.runMutation(
          internal.threads.findOrCreateForEmail,
          {
            orgId,
            userId: primaryUserId,
            subject,
            legacyConversationId: threadId ?? conversationId,
            mode: effectiveMode,
            agentDomain: getAgentDomain(),
          },
        );
      }

      await ctx.runMutation(internal.threads.insertEmailMessage, {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attachments: attachmentRecords.length > 0 ? attachmentRecords as any : undefined,
        legacyConversationId: conversationId,
      });
    } catch (err) {
      console.warn("Unified thread dual-write (inbound) failed:", err);
    }

    // Unknown mode: notify the primary insurance contact (or first admin)
    if (effectiveMode === "unknown") {
      try {
        const notifyUserId = org.primaryInsuranceContactId ?? firstAdmin?.userId;
        let notifyEmail: string | undefined;
        if (notifyUserId) {
          const notifyUser = await ctx.runQuery(internal.users.getInternal, { id: notifyUserId });
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
          text.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>');
        const htmlBody = notificationBody
          .split("\n\n")
          .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${autoLink(p.replace(/\n/g, "<br>"))}</p>`)
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

        const sendResult = await sendResendEmail(emailPayload as Parameters<typeof sendResendEmail>[0]);
        if (!sendResult.ok) {
          throw new Error(`Failed to send notification: ${sendResult.error}`);
        }
        const sentMessageId = sendResult.id;

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: conversationId,
          responseBody: notificationBody,
          responseTo: notifyEmail,
          responseMessageId: sentMessageId,
        });

        // Dual-write: insert agent notification into unified thread
        if (unifiedThreadId) {
          try {
            await ctx.runMutation(internal.threads.insertEmailMessage, {
              threadId: unifiedThreadId,
              orgId,
              role: "agent",
              content: notificationBody,
              responseMessageId: sentMessageId,
              legacyConversationId: conversationId,
            });
          } catch (err) {
            console.warn("Unified thread dual-write (unknown-mode response) failed:", err);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Agent unknown-mode notification error:", message);
        await ctx.runMutation(internal.agentConversations.updateError, {
          id: conversationId,
          error: message,
        });
      }
      return;
    }

    try {
      // Fetch org's policies and quotes
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId,
      });
      const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";

      // Get primary user profile for name reference
      const primaryUser = await ctx.runQuery(internal.users.getInternal, { id: primaryUserId });
      const userName = primaryUser?.name?.split(/\s+/)[0];

      // Resolve the connected broker (if this is a client org) for COI/broker prompts.
      let brokerName: string | undefined;
      let brokerContactName: string | undefined;
      let brokerContactEmail: string | undefined;
      if (org.type === "client" && org.brokerOrgId) {
        const brokerRecord = await ctx.runQuery(internal.orgs.getInternal, { id: org.brokerOrgId });
        if (brokerRecord) {
          brokerName = brokerRecord.name;
          if (brokerRecord.primaryInsuranceContactId) {
            const brokerContact = await ctx.runQuery(internal.users.getInternal, {
              id: brokerRecord.primaryInsuranceContactId,
            });
            brokerContactName = brokerContact?.name;
            brokerContactEmail = brokerContact?.email;
          }
        }
      }
      const agentCtx: AgentContext = {
        platform: "email",
        intent: effectiveMode === "direct" ? "direct" : effectiveMode === "cc" ? "mediated" : "observed",
        companyName: org.name,
        companyContext: org.context,
        siteUrl,
        userName,
        coiHandling: org.coiHandling as "broker" | "user" | "ignore" | "member" | undefined,
        brokerName,
        brokerContactName,
        brokerContactEmail,
        agentName: "Glass",
      };
      const systemPrompt = buildAgentSystemPrompt(agentCtx);
      const { context: policyContext, relevantPolicyIds, relevantQuoteIds } = await buildDocumentContext(
        ctx,
        orgId,
        policies,
        [],
        subject + " " + body,
      );

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(ctx, orgId, subject + " " + body);

      // Build messages — include thread history for context
      const messages: ModelMessage[] = [];

      if (threadId) {
        const threadMessages = await ctx.runQuery(
          internal.agentConversations.getThreadMessages,
          { threadId },
        );
        for (const msg of threadMessages) {
          if (msg._id === conversationId) continue;
          messages.push({
            role: "user",
            content: `Subject: ${msg.subject}\n\nFrom: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}\n\n${msg.body}`,
          });
          if (msg.responseBody) {
            messages.push({ role: "assistant", content: msg.responseBody });
          }
        }
      }

      // Build the current message — include attachments if present
      const emailText = `Subject: ${subject}\n\nFrom: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}\n\n${body}`;

      // Only include supported text/PDF attachments in Claude context
      const claudeAttachments = attachments.filter(
        (a) => SUPPORTED_ATTACHMENT_TYPES.has(a.content_type),
      );

      if (claudeAttachments.length > 0) {
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "file"; data: string; mediaType: string }
          | { type: "image"; image: string; mediaType: string }
        > = [];

        for (const att of claudeAttachments) {
          if (att.content_type === "application/pdf") {
            contentParts.push({
              type: "file",
              data: att.buffer.toString("base64"),
              mediaType: "application/pdf",
            });
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
      let systemContext = `${systemPrompt}\n\n${policyContext}${memoryContext}`;
      if (claudeAttachments.length > 0) {
        const filenames = claudeAttachments.map((a) => a.filename).join(", ");
        systemContext += `\n\nATTACHMENTS: The user's email includes ${claudeAttachments.length} attachment(s): ${filenames}. The content has been provided to you. Reference relevant information from attachments in your response when applicable.`;
      }

      // Email-sending instructions for internal users in direct mode
      if (isInternal && effectiveMode === "direct") {
        const autoSend = org.autoSendEmails === true;
        systemContext += `\n\nEMAIL SENDING:
You can send emails on behalf of team members. When a team member asks you to send/email/forward something to someone:
${autoSend
  ? `- Output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after.`
  : `- ALWAYS draft first: show the email labeled as "**Draft email to Name (email@example.com):**" followed by the draft content. Then ask explicitly: "Ready to send?" Do NOT send without drafting first — even if the user says "send" or "email", always show the draft for review first.
- Only after they explicitly approve the draft (e.g. "yes", "send it", "looks good", "go ahead"): output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after.`}

For emails, compose a professional message that:
- Addresses the recipient by name
- Incorporates the team member's direction naturally
- Maintains appropriate tone for the business relationship
- References relevant policy/coverage data when applicable
- Writes from Glass's perspective (third-person on behalf of the company). Do NOT sign off as the team member or impersonate them.`;
      }

      // ── Build agentic tool set — the model decides whether to answer,
      // generate a COI, or extract an uploaded policy from attachments. ──
      // Map attachment filenames -> storageIds so the agent can reference them.
      const attachmentIndex: Record<string, { fileId: string; contentType: string }> = {};
      for (const rec of attachmentRecords) {
        if (rec.fileId) {
          attachmentIndex[rec.filename] = { fileId: rec.fileId, contentType: rec.contentType };
        }
      }

      const emailTools = {
        lookup_policy: {
          ...lookupPolicy,
          execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
            const q = params.query.toLowerCase();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const matches = (policies as any[]).filter((p) => {
              const matchesQuery =
                p.insuredName?.toLowerCase().includes(q) ||
                p.security?.toLowerCase().includes(q) ||
                p.policyNumber?.toLowerCase().includes(q) ||
                p.policyTypes?.some((t: string) => t.toLowerCase().includes(q));
              const matchesType = !params.policyType || p.policyTypes?.includes(params.policyType);
              const matchesCarrier = !params.carrier ||
                p.security?.toLowerCase().includes(params.carrier.toLowerCase());
              return matchesQuery && matchesType && matchesCarrier;
            });
            if (matches.length === 0) return "No matching policies found.";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return matches.slice(0, 5).map((p: any) => ({
              id: p._id,
              insured: p.insuredName,
              carrier: p.security,
              type: p.policyTypes?.join(", "),
              number: p.policyNumber,
              effective: p.effectiveDate,
              expiration: p.expirationDate,
              premium: p.premium,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              coverages: (p.coverages ?? []).map((c: any) => ({
                name: c.name, limit: c.limit, deductible: c.deductible,
              })),
            }));
          },
        },
        lookup_policy_section: {
          ...lookupPolicySection,
          execute: async (params: { policyId: string; query: string }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const policy: any = await ctx.runQuery(
              internal.policies.getInternal,
              { id: params.policyId as Id<"policies"> },
            );
            if (!policy || policy.orgId !== orgId) return "Policy not found.";
            const doc = policy.document;
            if (!doc) return "No document data available for this policy.";
            const q = params.query.toLowerCase();
            const results: Array<{ title: string; type: string; content: string }> = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const s of (doc.sections ?? []) as any[]) {
              const text = `${s.title ?? ""} ${s.content ?? ""}`.toLowerCase();
              if (text.includes(q)) {
                results.push({
                  title: s.title,
                  type: "section",
                  content: String(s.content ?? "").slice(0, 4000),
                });
              }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const e of (doc.endorsements ?? []) as any[]) {
              const text = `${e.title ?? ""} ${e.content ?? ""}`.toLowerCase();
              if (text.includes(q)) {
                results.push({
                  title: e.title,
                  type: "endorsement",
                  content: String(e.content ?? "").slice(0, 4000),
                });
              }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const cov of (policy.coverages ?? []) as any[]) {
              const text = `${cov.name ?? ""} ${cov.limit ?? ""}`.toLowerCase();
              if (text.includes(q)) {
                const parts = [cov.name];
                if (cov.limit) parts.push(`Limit: ${cov.limit}`);
                if (cov.deductible) parts.push(`Deductible: ${cov.deductible}`);
                results.push({
                  title: cov.name,
                  type: "coverage",
                  content: parts.join("\n"),
                });
              }
            }
            return results.slice(0, 5);
          },
        },
        compare_coverages: {
          ...compareCoverages,
          execute: async (params: { policyId1: string; policyId2: string }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p1 = (policies as any[]).find((p) => p._id === params.policyId1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p2 = (policies as any[]).find((p) => p._id === params.policyId2);
            if (!p1 || !p2) return "One or both policies not found.";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mapP = (p: any) => ({
              id: p._id, carrier: p.security, type: p.policyTypes, limits: p.limits,
              deductibles: p.deductibles, premium: p.premium,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              coverages: (p.coverages ?? []).map((c: any) => ({
                name: c.name, limit: c.limit, deductible: c.deductible,
              })),
            });
            return { policy1: mapP(p1), policy2: mapP(p2) };
          },
        },
        save_note: {
          ...saveNote,
          execute: async (params: { content: string; type: string; policyId?: string }) => {
            const typeMap: Record<string, "fact" | "preference" | "risk_note" | "observation"> = {
              fact: "fact", preference: "preference", risk_note: "risk_note", observation: "observation",
            };
            await ctx.runMutation(internal.orgMemory.upsert, {
              orgId,
              type: typeMap[params.type] ?? "observation",
              content: params.content,
              source: "email" as const,
              policyId: params.policyId as Id<"policies"> | undefined,
            });
            return "Note saved.";
          },
        },
        generate_coi: {
          ...generateCoiTool,
          execute: async (params: { policyId: string; certificateHolder?: string }) => {
            const autoGenerate = org.autoGenerateCoi !== false;
            if (!autoGenerate) {
              const handling = org.coiHandling ?? "ignore";
              if (handling === "broker") {
                return `COI auto-generation is off. Please contact your broker to obtain this certificate.`;
              }
              if (handling === "member") {
                return `COI auto-generation is off. Please route this COI request to your primary insurance contact.`;
              }
              return `COI auto-generation is disabled for this organization.`;
            }
            try {
              await ctx.scheduler.runAfter(
                0,
                internal.actions.generateCoi.run,
                {
                  policyId: params.policyId as Id<"policies">,
                  orgId,
                  certificateHolder: params.certificateHolder,
                },
              );
              return "COI generation started. It will be emailed or available for download shortly.";
            } catch (err) {
              return `Failed to generate COI: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        },
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
              if ("error" in result) return `Extraction failed: ${result.error}`;
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
            const rec = attachmentRecords.find((r) => r.filename === a.filename);
            return rec?.fileId ? `- "${a.filename}" (storageId: ${rec.fileId})` : null;
          })
          .filter(Boolean);
        if (pdfAttachments.length > 0) {
          attachmentToolHint = `\n\nATTACHMENT TOOLS:
If any attached PDF appears to be a policy, declarations page, quote, binder, COI, or other insurance document that should be added to the organization's policy library, call the extract_policy_attachment tool. PDFs are also provided inline so you may read them to answer questions.

PDF ATTACHMENT MANIFEST (storageId -> fileName):
${pdfAttachments.join("\n")}

IMPORTANT GROUPING RULE: A real-world policy commonly arrives as multiple PDFs in the SAME email (for example: COI + declarations + full policy wording). If multiple PDFs in this email describe the SAME policy, call extract_policy_attachment ONCE with ALL of them in the files array — they will be combined into a single policy record. Only make separate extract_policy_attachment calls when the attachments clearly belong to DIFFERENT policies.`;
        }
      }

      systemContext += attachmentToolHint;
      systemContext += `\n\nYou have tools to look up policies, look up policy sections, compare coverages, save notes, generate COIs, and extract uploaded policy attachments. Use them as needed before answering. Decide yourself whether the email requires answering a question, generating a COI, and/or extracting an attached policy — you may do more than one.`;

      // Agentic loop — the model decides tools (COI, policy extraction, Q&A)
      const result = await generateText({
        model: getModel("chat"),
        maxOutputTokens: 4096,
        system: systemContext,
        messages,
        tools: emailTools,
        stopWhen: stepCountIs(10),
      });

      let responseBody = result.text;

      // ── Detect "Sending email to..." pattern for third-party sends ──
      const sendMatch = responseBody.match(/\*?\*?Sending email to (.+?)\.\.\.\*?\*?\s*\n([\s\S]+)$/i);
      if (isInternal && sendMatch) {
        try {
          const emailBody = sendMatch[2].trim();
          const recipientHint = sendMatch[1].trim();
          const hintEmailMatch = recipientHint.match(/[\w.+-]+@[\w.-]+\.\w+/);
          const thirdPartyEmail = hintEmailMatch?.[0];
          if (!thirdPartyEmail) throw new Error("No recipient email found in agent output");

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
            r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" ${ls}>$1</a>`);
            r = r.replace(/(?<!href=")(https?:\/\/[^\s<)]+)/g, `<a href="$1" ${ls}>$1</a>`);
            r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
            r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
            return r;
          };

          const sig = buildSignature(agentAddress, brokerBranding);
          const plainText = stripMd(emailBody) + sig.text;
          const htmlBody = emailBody
            .split("\n\n")
            .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${mdToHtml(p.replace(/\n/g, "<br>"))}</p>`)
            .join("\n") + sig.html;

          const sendSubject = subject.replace(/^\[Glass\]\s*Help needed:\s*/i, "");
          const replySub = sendSubject.startsWith("Re:") ? sendSubject : `Re: ${sendSubject}`;

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
              "References": messageId,
            };
          }

          // Check send delay setting
          const sendDelay = org?.emailSendDelay ?? 5; // default 5 seconds

          if (sendDelay > 0 && unifiedThreadId) {
            // Queue email with delay
            const scheduledSendTime = Date.now() + sendDelay * 1000;
            const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
              orgId,
              threadId: unifiedThreadId,
              emailPayload: JSON.stringify(sendPayload),
              scheduledSendTime,
              legacyConversationId: conversationId,
              recipientEmail: thirdPartyEmail,
              ccAddresses: sendCc,
              subject: replySub,
              emailBody,
              referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
              referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"policies">[]) : undefined,
            });

            // Update legacy conversation to pending state
            await ctx.runMutation(internal.agentConversations.updateResponse, {
              id: conversationId,
              responseBody: `Sending email to ${thirdPartyEmail} (CC: ${fromEmail})...`,
              responseTo: thirdPartyEmail,
              responseCc: sendCc,
              referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
              referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"policies">[]) : undefined,
            });

            // Schedule the actual send
            await ctx.scheduler.runAfter(
              sendDelay * 1000,
              internal.actions.sendPendingEmail.sendPending,
              { id: pendingEmailId },
            );
          } else {
            // Send immediately (delay = 0 or no unified thread)
            const sendOutcome = await sendResendEmail(sendPayload as Parameters<typeof sendResendEmail>[0]);
            if (!sendOutcome.ok) throw new Error(`Failed to send email: ${sendOutcome.error}`);
            const sentMsgId = sendOutcome.id;

            const confirmText = `Email sent to ${thirdPartyEmail} (CC: ${fromEmail}).`;
            await ctx.runMutation(internal.agentConversations.updateResponse, {
              id: conversationId,
              responseBody: confirmText,
              responseTo: thirdPartyEmail,
              responseCc: sendCc,
              responseMessageId: sentMsgId,
              referencedPolicyIds:
                relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
              referencedQuoteIds:
                relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"policies">[]) : undefined,
            });

            // Dual-write to unified thread
            if (unifiedThreadId) {
              try {
                await ctx.runMutation(internal.threads.insertEmailMessage, {
                  threadId: unifiedThreadId,
                  orgId,
                  role: "agent",
                  content: emailBody,
                  toAddresses: [thirdPartyEmail],
                  ccAddresses: sendCc,
                  subject: replySub,
                  responseMessageId: sentMsgId,
                  referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
                  referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"policies">[]) : undefined,
                  legacyConversationId: conversationId,
                });
              } catch (err) {
                console.warn("Unified thread dual-write (third-party send) failed:", err);
              }
            }
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
        result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
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
        result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          `<a href="$2" ${linkStyle}>$1</a>`);
        result = result.replace(/(?<!href=")(https?:\/\/[^\s<)]+)/g,
          `<a href="$1" ${linkStyle}>$1</a>`);
        result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
        return result;
      };
      const bodyHtmlContent = responseBody
        .split("\n\n")
        .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`)
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
      if ((effectiveMode === "cc" || effectiveMode === "forward") && primaryUserEmail) {
        if (replyTo !== primaryUserEmail && !replyCc.includes(primaryUserEmail)) {
          replyCc.push(primaryUserEmail);
        }
      }

      // Send reply via Resend
      const cleanSubject = effectiveMode === "forward"
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

      const sendResult = await sendResendEmail(emailPayload as Parameters<typeof sendResendEmail>[0]);
      if (!sendResult.ok) {
        throw new Error(`Failed to send reply: ${sendResult.error}`);
      }
      const sentMessageId = sendResult.id;

      await ctx.runMutation(internal.agentConversations.updateResponse, {
        id: conversationId,
        responseBody,
        responseTo: replyTo,
        responseCc: replyCc.length > 0 ? replyCc : undefined,
        responseMessageId: sentMessageId,
        referencedPolicyIds:
          relevantPolicyIds.length > 0
            ? (relevantPolicyIds as Id<"policies">[])
            : undefined,
        referencedQuoteIds:
          relevantQuoteIds.length > 0
            ? (relevantQuoteIds as Id<"policies">[])
            : undefined,
      });

      // Dual-write: insert agent response into unified thread
      if (unifiedThreadId) {
        try {
          await ctx.runMutation(internal.threads.insertEmailMessage, {
            threadId: unifiedThreadId,
            orgId,
            role: "agent",
            content: responseBody,
            toAddresses: [replyTo],
            ccAddresses: replyCc.length > 0 ? replyCc : undefined,
            responseMessageId: sentMessageId,
            referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
            referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"policies">[]) : undefined,
            legacyConversationId: conversationId,
          });
        } catch (err) {
          console.warn("Unified thread dual-write (agent response) failed:", err);
        }
      }

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
        const allowedTypes = new Set(["fact", "preference", "risk_note", "observation"]);
        const items = parsed
          .filter((it) => it && typeof it.content === "string" && allowedTypes.has(it.type))
          .slice(0, 5)
          .map((it) => ({
            orgId,
            type: it.type as "fact" | "preference" | "risk_note" | "observation",
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
      await ctx.runMutation(internal.agentConversations.updateError, {
        id: conversationId,
        error: message,
      });
    }
  },
});
