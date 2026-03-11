"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";
import { Webhook } from "svix";
import { buildSystemPrompt, buildDocumentContext } from "../lib/agentPrompts";
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

function findAgentHandle(addresses: string[]): string | null {
  for (const addr of addresses) {
    if (addr.endsWith(`@${getAgentDomain()}`)) {
      return addr.split("@")[0];
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
  const siteUrl = process.env.SITE_URL ?? "https://claritylabs.inc";
  const linkText = `Sent by Clarity Agent${companyName ? ` from ${companyName}` : ""}`;
  const text = [
    "",
    "—",
    `Clarity Agent${companyName ? ` for ${companyName}` : ""}`,
    agentEmail,
    `${linkText} - ${siteUrl}`,
  ].join("\n");

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">—</p>`,
    `<p style="font-size:13px;margin:4px 0 2px"><span style="color:#A0D2FA;font-size:13px;font-family:'Segoe UI Symbol','Apple Symbols',sans-serif">&#x2733;&#xFE0E;</span> <strong>Clarity Agent${companyName ? ` for ${companyName}` : ""}</strong></p>`,
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

interface ParsedAttachment {
  filename: string;
  content_type: string;
  /** base64-encoded content for PDFs, or extracted text */
  data: string;
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

async function fetchAttachments(emailId: string): Promise<ParsedAttachment[]> {
  const parsed: ParsedAttachment[] = [];

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
      if (!SUPPORTED_ATTACHMENT_TYPES.has(att.content_type)) continue;
      if (att.size > MAX_ATTACHMENT_SIZE) continue;

      try {
        const dlRes = await fetch(att.download_url);
        if (!dlRes.ok) continue;

        const buffer = Buffer.from(await dlRes.arrayBuffer());

        if (att.content_type === "application/pdf") {
          // Pass as base64 for Claude document parsing
          parsed.push({
            filename: att.filename,
            content_type: att.content_type,
            data: buffer.toString("base64"),
          });
        } else {
          // Text-based: decode as UTF-8
          parsed.push({
            filename: att.filename,
            content_type: att.content_type,
            data: buffer.toString("utf-8"),
          });
        }
      } catch (err) {
        console.warn(`Failed to download attachment ${att.filename}:`, err);
      }
    }
  } catch (err) {
    console.warn("Failed to fetch attachment list:", err);
  }

  return parsed;
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

    // Find agent handle
    const handle = findAgentHandle(allAddresses);
    if (!handle) {
      console.log("No agent handle found in recipients:", allAddresses);
      return;
    }

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
    const primaryUserId = org.primaryInsuranceContactId ?? firstAdmin?.userId;

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
    const agentAddress = `${handle}@${getAgentDomain()}`;
    const agentInTo = toAddresses.includes(agentAddress);
    const agentInCc = ccAddresses.includes(agentAddress);
    const otherToRecipients = toAddresses.filter((a) => a !== agentAddress);

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
    if (inReplyTo) {
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
      },
    );

    // Mark processing
    await ctx.runMutation(internal.agentConversations.markProcessing, {
      id: conversationId,
    });

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
          `Your Clarity Agent received an email it couldn't confidently classify, so it's forwarding it to you for review.`,
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

        const notifSubject = `[Clarity Agent] Help needed: ${subject}`;

        const emailPayload: Record<string, unknown> = {
          from: `Clarity Agent <${agentAddress}>`,
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

      const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

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

      // Build messages — include thread history for context
      const messages: Anthropic.MessageParam[] = [];

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

      if (attachments.length > 0) {
        const contentBlocks: Anthropic.ContentBlockParam[] = [];

        for (const att of attachments) {
          if (att.content_type === "application/pdf") {
            contentBlocks.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: att.data,
              },
              title: att.filename,
            } as any);
          } else {
            contentBlocks.push({
              type: "text",
              text: `--- Attachment: ${att.filename} ---\n${att.data}\n--- End attachment ---`,
            });
          }
        }

        contentBlocks.push({ type: "text", text: emailText });
        messages.push({ role: "user", content: contentBlocks });
      } else {
        messages.push({ role: "user", content: emailText });
      }

      // Build system context with optional attachment note
      let systemContext = `${systemPrompt}\n\n${policyContext}`;
      if (attachments.length > 0) {
        const filenames = attachments.map((a) => a.filename).join(", ");
        systemContext += `\n\nATTACHMENTS: The user's email includes ${attachments.length} attachment(s): ${filenames}. The content has been provided to you. Reference relevant information from attachments in your response when applicable.`;
      }

      // Call Claude Haiku
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemContext,
        messages,
      });

      let responseBody =
        response.content[0].type === "text" ? response.content[0].text : "";

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
      const plainTextBody = responseBody.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
      const signature = buildSignature(agentAddress, org.name);
      const fullReplyText = plainTextBody + signature.text;

      const linkStyle = 'style="color:#2563eb;text-decoration:underline"';
      const convertLinks = (text: string) => {
        let result = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          `<a href="$2" ${linkStyle}>$1</a>`);
        result = result.replace(/(?<!href=")(https?:\/\/[^\s<)]+)/g,
          `<a href="$1" ${linkStyle}>$1</a>`);
        return result;
      };
      const bodyHtmlContent = responseBody
        .split("\n\n")
        .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${convertLinks(p.replace(/\n/g, "<br>"))}</p>`)
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
          (a) => a !== agentAddress && a !== fromEmail,
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
        from: `Clarity Agent <${agentAddress}>`,
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
