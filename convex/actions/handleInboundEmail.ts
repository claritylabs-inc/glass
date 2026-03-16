"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import { Webhook } from "svix";
import { buildSystemPrompt, buildDocumentContext, buildConversationMemoryContext } from "../lib/agentPrompts";
import { Id } from "../_generated/dataModel";

const DEFAULT_AGENT_DOMAIN = "agent.claritylabs.inc";

function getAgentDomain(): string {
  return process.env.AGENT_DOMAIN ?? DEFAULT_AGENT_DOMAIN;
}

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

function buildSignature(agentEmail: string, companyName?: string): { text: string; html: string } {
  const siteUrl = process.env.SITE_URL ?? "https://email.claritylabs.inc";
  const linkText = `Sent by Cell Agent${companyName ? ` from ${companyName}` : ""}`;
  const text = [
    "",
    "—",
    `Cell Agent${companyName ? ` for ${companyName}` : ""}`,
    agentEmail,
    `${linkText} - ${siteUrl}`,
  ].join("\n");

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">—</p>`,
    `<p style="font-size:13px;margin:4px 0 2px"><span style="color:#A0D2FA;font-size:13px;font-family:'Segoe UI Symbol','Apple Symbols',sans-serif">&#x2733;&#xFE0E;</span> <strong>Cell Agent${companyName ? ` for ${companyName}` : ""}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    `<p style="font-size:12px;margin:12px 0 0"><a href="${siteUrl}" style="color:#A0D2FA;text-decoration:none">${linkText}</a></p>`,
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

    // Resolve org by handle (org-first, then legacy user fallback)
    const org = await ctx.runQuery(internal.orgs.getByHandle, { handle });
    if (!org) {
      console.log("No organization found for handle:", handle);
      return;
    }

    const orgId = org._id;

    // Get all org members for domain detection and primary contact resolution
    const orgMembers = await ctx.runQuery(internal.orgs.getMembersInternal, { orgId });
    const memberEmails = orgMembers
      .map((m: any) => m.user?.email)
      .filter(Boolean) as string[];
    const firstAdmin = orgMembers.find((m: any) => m.role === "admin");

    // Match sender to an org member by email — so the right user is attributed
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
        return rawHeaders.find(
          (h: any) => h.name?.toLowerCase() === lower,
        )?.value;
      } else if (rawHeaders && typeof rawHeaders === "object") {
        return (rawHeaders as any)[lower] ?? (rawHeaders as any)[name];
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
        attachments: attachmentRecords.length > 0 ? attachmentRecords as any : undefined,
        legacyConversationId: conversationId,
      });
    } catch (err) {
      console.warn("Unified thread dual-write (inbound) failed:", err);
    }

    // ── Application detection: reply to existing application thread ──
    // Try multiple strategies to find the active application session:
    // 1. By threadId (resolved from In-Reply-To or subject matching)
    // 2. By lastSentMessageId (the reply's In-Reply-To matches an outbound app email)
    // 3. By orgId fallback (active session exists for this org in asking/pending state)
    let activeSession: any = null;

    if (threadId) {
      activeSession = await ctx.runQuery(
        internal.applicationSessions.findByThreadId,
        { threadId },
      );
    }

    if (!activeSession && inReplyTo) {
      activeSession = await ctx.runQuery(
        internal.applicationSessions.findBySentMessageId,
        { messageId: inReplyTo },
      );
    }

    if (!activeSession) {
      activeSession = await ctx.runQuery(
        internal.applicationSessions.findActiveByOrg,
        { orgId },
      );
    }

    if (
      activeSession &&
      !["complete", "cancelled"].includes(activeSession.status)
    ) {
      if (activeSession.status === "pending_confirmation") {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.processApplication.processConfirmationReply,
          {
            conversationId,
            sessionId: activeSession._id,
            body,
            fromEmail,
            agentAddress,
            subject,
            companyName: org.name,
            messageId,
          },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.processApplication.processApplicationReply,
          {
            conversationId,
            sessionId: activeSession._id,
            body,
            fromEmail,
            agentAddress,
            subject,
            companyName: org.name,
            messageId,
          },
        );
      }
      return; // skip normal agent flow
    }

    // ── Application detection: new application (direct mode + PDF attachment) ──
    if (effectiveMode === "direct" && attachments.length > 0) {
      const pdfAttachments = attachments.filter(
        (a) => a.content_type === "application/pdf",
      );

      if (pdfAttachments.length > 0) {
        // Check email body for application intent keywords
        const bodyLower = (body ?? "").toLowerCase();
        const applicationKeywords = [
          "application",
          "apply",
          "fill out",
          "fill in",
          "complete this form",
          "help me fill",
          "insurance form",
          "acord",
          "application form",
        ];
        const hasApplicationIntent = applicationKeywords.some((kw) =>
          bodyLower.includes(kw),
        );

        if (hasApplicationIntent) {
          // Classify the first PDF attachment via inline Haiku call
          const pdfAtt = pdfAttachments[0];
          const pdfBase64 = pdfAtt.buffer.toString("base64");

          const { text: classifyText } = await generateText({
            model: haikuModel,
            maxOutputTokens: 256,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    data: pdfBase64,
                    mediaType: "application/pdf",
                  },
                  {
                    type: "text",
                    text: `You are classifying a PDF document. Determine if this is an insurance APPLICATION FORM (a form to be filled out to apply for insurance) versus a policy document, quote, certificate, or other document.

Respond with JSON only:
{ "isApplication": boolean, "confidence": number, "applicationType": string | null }`,
                  },
                ],
              },
            ],
          });
          let isApplication = false;
          let confidence = 0;
          let applicationType: string | null = null;
          try {
            const parsed = JSON.parse(
              classifyText
                .replace(/^```(?:json)?\s*\n?/i, "")
                .replace(/\n?```\s*$/i, ""),
            );
            isApplication = parsed.isApplication;
            confidence = parsed.confidence;
            applicationType = parsed.applicationType;
          } catch {
            // Not an application
          }

          if (isApplication && confidence > 0.7) {
            // Store PDF in file storage (already stored as attachmentRecords)
            const storedRecord = attachmentRecords.find(
              (r) =>
                r.filename === pdfAtt.filename && r.fileId,
            );
            const fileId = storedRecord?.fileId;

            if (fileId) {
              await ctx.scheduler.runAfter(
                0,
                internal.actions.processApplication.startApplicationSession,
                {
                  conversationId,
                  orgId,
                  userId: primaryUserId,
                  fileId: fileId as Id<"_storage">,
                  fileName: pdfAtt.filename,
                  pdfBase64,
                  fromEmail,
                  subject,
                  agentAddress,
                  threadId: threadId ?? conversationId,
                  companyName: org.name,
                  applicationTitle: applicationType ?? undefined,
                  messageId,
                },
              );
              return; // skip normal agent flow
            }
          }
        }
      }
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
          `Your Cell Agent received an email it couldn't confidently classify, so it's forwarding it to you for review.`,
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

        const signature = buildSignature(agentAddress, org.name);
        const fullText = notificationBody + signature.text;

        const autoLink = (text: string) =>
          text.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>');
        const htmlBody = notificationBody
          .split("\n\n")
          .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${autoLink(p.replace(/\n/g, "<br>"))}</p>`)
          .join("\n");
        const fullHtml = htmlBody + signature.html;

        const notifSubject = `[Cell Agent] Help needed: ${subject}`;

        const emailPayload: Record<string, unknown> = {
          from: `Cell Agent <${agentAddress}>`,
          to: notifyEmail,
          subject: notifSubject,
          text: fullText,
          html: fullHtml,
        };

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailPayload),
        });

        const resBody = await res.text();
        if (!res.ok) {
          throw new Error(`Failed to send notification: ${resBody}`);
        }

        let sentMessageId: string | undefined;
        try {
          const sendResult = JSON.parse(resBody);
          sentMessageId = sendResult.id;
        } catch { /* non-critical */ }

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
      const quotes = await ctx.runQuery(internal.quotes.listAllInternal, {
        orgId,
      });

      const siteUrl = process.env.SITE_URL ?? "https://email.claritylabs.inc";

      // Get primary user profile for name reference
      const primaryUser = await ctx.runQuery(internal.users.getInternal, { id: primaryUserId });
      const userName = primaryUser?.name?.split(/\s+/)[0];

      // Build prompt using org fields
      const systemPrompt = buildSystemPrompt(
        effectiveMode,
        org.context,
        siteUrl,
        org.name,
        userName,
        org.coiHandling as any,
        org.insuranceBroker,
        org.brokerContactName,
        org.brokerContactEmail,
      );
      const { context: policyContext, relevantPolicyIds, relevantQuoteIds } = buildDocumentContext(
        policies,
        quotes,
        subject + " " + body,
      );

      // Search for relevant past conversations across the org
      const pastConversations = await ctx.runQuery(
        internal.agentConversations.searchOrgConversations,
        {
          orgId,
          queryText: subject + " " + body,
          excludeThreadId: threadId,
        },
      );
      const memoryContext = buildConversationMemoryContext(pastConversations);

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
        const contentParts: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string }> = [];

        for (const att of claudeAttachments) {
          if (att.content_type === "application/pdf") {
            contentParts.push({
              type: "file",
              data: att.buffer.toString("base64"),
              mediaType: "application/pdf",
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
- Writes from Cell Agent's perspective (third-person on behalf of the company). Do NOT sign off as the team member or impersonate them.`;
      }

      // Call Claude Haiku
      const { text: responseBody_ } = await generateText({
        model: haikuModel,
        maxOutputTokens: 2048,
        system: systemContext,
        messages,
      });

      let responseBody = responseBody_;

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

          const sig = buildSignature(agentAddress, org.name);
          const plainText = stripMd(emailBody) + sig.text;
          const htmlBody = emailBody
            .split("\n\n")
            .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${mdToHtml(p.replace(/\n/g, "<br>"))}</p>`)
            .join("\n") + sig.html;

          const sendSubject = subject.replace(/^\[Cell Agent\]\s*Help needed:\s*/i, "");
          const replySub = sendSubject.startsWith("Re:") ? sendSubject : `Re: ${sendSubject}`;

          const sendCc = [fromEmail]; // CC the internal user who gave the instruction

          const sendPayload: Record<string, unknown> = {
            from: `Cell Agent <${agentAddress}>`,
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
              referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"quotes">[]) : undefined,
            });

            // Update legacy conversation to pending state
            await ctx.runMutation(internal.agentConversations.updateResponse, {
              id: conversationId,
              responseBody: `Sending email to ${thirdPartyEmail} (CC: ${fromEmail})...`,
              responseTo: thirdPartyEmail,
              responseCc: sendCc,
              referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
              referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"quotes">[]) : undefined,
            });

            // Schedule the actual send
            await ctx.scheduler.runAfter(
              sendDelay * 1000,
              internal.actions.sendPendingEmail.sendPending,
              { id: pendingEmailId },
            );
          } else {
            // Send immediately (delay = 0 or no unified thread)
            const sendRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(sendPayload),
            });
            const sendResBody = await sendRes.text();
            if (!sendRes.ok) throw new Error(`Failed to send email: ${sendResBody}`);

            let sentMsgId: string | undefined;
            try { sentMsgId = JSON.parse(sendResBody).id; } catch {}

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
                relevantQuoteIds.length > 0 ? (relevantQuoteIds as Id<"quotes">[]) : undefined,
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
                  referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as any) : undefined,
                  referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as any) : undefined,
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
      const signature = buildSignature(agentAddress, org.name);
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
        from: `Cell Agent <${agentAddress}>`,
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

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      const resBody = await res.text();
      if (!res.ok) {
        throw new Error(`Failed to send reply: ${resBody}`);
      }

      let sentMessageId: string | undefined;
      try {
        const sendResult = JSON.parse(resBody);
        sentMessageId = sendResult.id;
      } catch {
        // Non-critical
      }

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
            ? (relevantQuoteIds as Id<"quotes">[])
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
            referencedPolicyIds: relevantPolicyIds.length > 0 ? (relevantPolicyIds as any) : undefined,
            referencedQuoteIds: relevantQuoteIds.length > 0 ? (relevantQuoteIds as any) : undefined,
            legacyConversationId: conversationId,
          });
        } catch (err) {
          console.warn("Unified thread dual-write (agent response) failed:", err);
        }
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
