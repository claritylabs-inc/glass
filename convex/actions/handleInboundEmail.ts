"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";
import { Webhook } from "svix";
import { buildSystemPrompt, buildPolicyContext } from "../lib/agentPrompts";
import { Id } from "../_generated/dataModel";

const AGENT_DOMAIN = "agent.claritylabs.inc";

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "zoho.com", "mail.com",
  "ymail.com", "gmx.com", "gmx.net",
]);

function getCompanyDomains(user: { email?: string; companyWebsite?: string }): string[] {
  const domains: string[] = [];
  if (user.companyWebsite) {
    try {
      const hostname = new URL(user.companyWebsite).hostname.replace(/^www\./, "");
      if (!CONSUMER_DOMAINS.has(hostname)) domains.push(hostname);
    } catch { /* ignore invalid URLs */ }
  }
  if (user.email) {
    const domain = user.email.split("@")[1]?.toLowerCase();
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
    if (addr.endsWith(`@${AGENT_DOMAIN}`)) {
      return addr.split("@")[0];
    }
  }
  return null;
}

/**
 * Strip inline quoted text from email body (the "On Mon, Jan 1 ... wrote:" chains).
 * Also strips lines starting with > which are quote markers.
 */
function stripQuotedText(body: string): string {
  // Match "On <date>... wrote:" pattern and everything after
  const onWrotePattern = /\r?\n\s*On .+wrote:\s*\r?\n[\s\S]*$/;
  let cleaned = body.replace(onWrotePattern, "");

  // Also strip "---------- Forwarded message ----------" blocks
  cleaned = cleaned.replace(/\r?\n\s*-{5,}\s*Forwarded message\s*-{5,}[\s\S]*$/, "");

  // Strip trailing lines that are all ">" quoted
  const lines = cleaned.split("\n");
  while (lines.length > 0 && /^\s*>/.test(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join("\n").trimEnd();
}

/**
 * Extract the original sender from a forwarded email body.
 * Supports Gmail, Outlook, and Apple Mail forward formats.
 */
function extractForwardedSender(body: string): string | null {
  // Gmail: "---------- Forwarded message ----------\nFrom: Name <email>"
  const gmailMatch = body.match(
    /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?From:\s*(?:[^<]*<)?([^\s<>]+@[^\s<>]+)/i,
  );
  if (gmailMatch) return gmailMatch[1].toLowerCase();

  // Apple Mail: "Begin forwarded message:\n...From: Name <email>"
  const appleMatch = body.match(
    /Begin forwarded message:[\s\S]*?From:\s*(?:[^<]*<)?([^\s<>]+@[^\s<>]+)/i,
  );
  if (appleMatch) return appleMatch[1].toLowerCase();

  // Outlook: "From: Name <email>\nSent: ..."
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

async function fetchEmailContent(emailId: string): Promise<ReceivedEmailContent> {
  // Resend's receiving API endpoint
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
    },
  });
  if (!res.ok) {
    console.warn(`Failed to fetch from receiving API (${res.status}), trying sent emails API...`);
    // Fallback to sent emails API
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

    // Dedup: prevent processing the same inbound email twice
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

    // Loop prevention: reject emails from agent domain
    if (fromEmail.endsWith(`@${AGENT_DOMAIN}`)) {
      console.log("Loop prevention: ignoring email from agent domain", fromEmail);
      return;
    }

    // Find agent handle
    const handle = findAgentHandle(allAddresses);
    if (!handle) {
      console.log("No agent handle found in recipients:", allAddresses);
      return;
    }

    // Resolve user
    const user = await ctx.runQuery(
      internal.agentConversations.getUserByHandle,
      { handle },
    );
    if (!user) {
      console.log("No user found for handle:", handle);
      return;
    }

    // Fetch full email content from Resend API
    const emailContent = await fetchEmailContent(data.email_id);
    const rawBody = emailContent.text ?? "";
    const body = stripQuotedText(rawBody);
    const bodyHtml = emailContent.html ?? undefined;

    // Fetch user profile early (needed for mode detection + later use)
    const userProfile = await ctx.runQuery(internal.users.getInternal, {
      id: user._id,
    });

    // Detect mode
    const agentAddress = `${handle}@${AGENT_DOMAIN}`;
    const agentInTo = toAddresses.includes(agentAddress);
    const agentInCc = ccAddresses.includes(agentAddress);
    const otherToRecipients = toAddresses.filter((a) => a !== agentAddress);

    const senderDomain = fromEmail.split("@")[1]?.toLowerCase();
    const companyDomains = getCompanyDomains(userProfile ?? {});
    const isInternal = !!(senderDomain && companyDomains.includes(senderDomain));

    const subjectIsForward = /^Fwd?:/i.test(data.subject ?? "");
    const bodyIsForward = /(?:-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:)/i.test(rawBody);
    const isForwarded = subjectIsForward || bodyIsForward;

    const mode: "direct" | "cc" | "forward" | "unknown" =
      // Forward detection takes priority for internal senders — they may have
      // the agent in To or CC when forwarding depending on the email client.
      isInternal && isForwarded
        ? "forward"
        : agentInCc
          ? "cc"
          : isInternal && agentInTo && otherToRecipients.length > 0
            ? "cc"
            : agentInTo && otherToRecipients.length === 0
              ? "direct"
              : "unknown";

    // Threading — extract headers
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

    // Resolve thread: try In-Reply-To header first, then fall back to subject matching
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

    // Fallback: match by subject line (handles Re: prefixes)
    if (!threadId) {
      const subjectMatch = await ctx.runQuery(
        internal.agentConversations.findThreadBySubject,
        { userId: user._id, subject, fromEmail },
      );
      if (subjectMatch) {
        threadId = subjectMatch.threadId ?? subjectMatch._id;
        threadRootMode = subjectMatch.threadId
          ? (await ctx.runQuery(internal.agentConversations.getById, { id: subjectMatch.threadId }))?.mode
          : subjectMatch.mode;
      }
    }

    // Inherit mode from thread root for follow-up messages.
    // Domain guard: external senders (not on company domain) can never be "direct" —
    // if an external sender ends up in a direct-detected situation, force to "cc".
    let effectiveMode = threadRootMode ?? mode;
    if (effectiveMode === "direct" && !isInternal) {
      effectiveMode = "unknown";
    }

    // Create conversation record
    const conversationId = await ctx.runMutation(
      internal.agentConversations.insertInbound,
      {
        userId: user._id,
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

    // Unknown mode: notify the user instead of replying to the sender
    if (effectiveMode === "unknown") {
      try {
        const agentAddress = `${handle}@${AGENT_DOMAIN}`;
        const userEmail = userProfile?.email;
        if (!userEmail) {
          throw new Error("User has no email address — cannot send notification");
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

        const signature = buildSignature(agentAddress, userProfile?.companyName);
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
          to: userEmail,
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
          responseTo: userEmail,
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
      // Fetch user's policies
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        userId: user._id,
      });

      const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

      // Build prompt
      const userName = userProfile?.name?.split(/\s+/)[0];
      const systemPrompt = buildSystemPrompt(
        effectiveMode,
        userProfile?.companyContext,
        siteUrl,
        userProfile?.companyName,
        userName,
        userProfile?.coiHandling,
        userProfile?.insuranceBroker,
        userProfile?.brokerContactName,
        userProfile?.brokerContactEmail,
      );
      const { context: policyContext, relevantPolicyIds } = buildPolicyContext(
        policies,
        subject + " " + body,
      );

      // Build messages — include thread history for context
      const messages: { role: "user" | "assistant"; content: string }[] = [];

      if (threadId) {
        const threadMessages = await ctx.runQuery(
          internal.agentConversations.getThreadMessages,
          { threadId },
        );
        // Add prior messages (exclude the one we just created)
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

      // Add current message
      messages.push({
        role: "user",
        content: `Subject: ${subject}\n\nFrom: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}\n\n${body}`,
      });

      // Call Claude Haiku
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: `${systemPrompt}\n\n${policyContext}`,
        messages,
      });

      let responseBody =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Domain guard: strip internal URLs from customer-facing replies
      // This is the primary safety check — even if the LLM ignores the prompt,
      // we never leak internal links to external recipients.
      if (effectiveMode === "cc" || effectiveMode === "forward") {
        const escapedSiteUrl = siteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Strip markdown links with internal URLs: [text](internal-url) → text
        responseBody = responseBody.replace(
          new RegExp(`\\[([^\\]]+)\\]\\(${escapedSiteUrl}[^)]*\\)`, "g"),
          "$1",
        );
        // Strip any remaining bare internal URLs
        responseBody = responseBody.replace(
          new RegExp(`${escapedSiteUrl}[^\\s)]*`, "g"),
          "[internal link removed]",
        );
      }

      // Build reply with signature
      // Strip markdown links for plain text: [text](url) → text (url)
      const plainTextBody = responseBody.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
      const signature = buildSignature(agentAddress, userProfile?.companyName);
      const fullReplyText = plainTextBody + signature.text;

      // Convert response body to HTML paragraphs
      // 1. Convert markdown links [text](url) to <a> tags
      // 2. Auto-link any remaining bare URLs as fallback
      const linkStyle = 'style="color:#2563eb;text-decoration:underline"';
      const convertLinks = (text: string) => {
        // First: markdown links
        let result = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          `<a href="$2" ${linkStyle}>$1</a>`);
        // Then: bare URLs not already inside an href
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
      const userEmail = userProfile?.email;
      let replyTo: string;
      let replyCc: string[] = [];

      if (effectiveMode === "forward") {
        const originalSender = extractForwardedSender(rawBody);
        replyTo = originalSender ?? fromEmail;
        replyCc = [fromEmail];
        // Remove the forwarder from CC if they ended up as replyTo (fallback case)
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

      // Always ensure the user is CC'd on cc/forward replies (they may not be
      // in the address lists on follow-up messages from external senders)
      if ((effectiveMode === "cc" || effectiveMode === "forward") && userEmail) {
        if (replyTo !== userEmail && !replyCc.includes(userEmail)) {
          replyCc.push(userEmail);
        }
      }

      // Send reply via Resend
      // Strip Fwd:/Fw: prefix for forward mode replies
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
      // For forward mode, thread against the original conversation, not the forwarded message.
      // X-Forwarded-Message-Id (Gmail) gives the original Message-ID directly.
      // References header contains the chain; the last entry is the most recent message.
      const replyHeaders: Record<string, string> = {};
      if (effectiveMode === "forward") {
        const xFwd = getHeader("X-Forwarded-Message-Id");
        const refs = getHeader("References");
        // Pick the best original message ID: X-Forwarded-Message-Id > last in References > forwarded messageId
        const originalMessageId =
          xFwd ||
          (refs ? refs.trim().split(/\s+/).pop() : undefined) ||
          messageId;
        if (originalMessageId) {
          replyHeaders["In-Reply-To"] = originalMessageId;
          // Preserve the full References chain so mail clients thread correctly
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

      // Extract response message ID for threading future replies
      let sentMessageId: string | undefined;
      try {
        const sendResult = JSON.parse(resBody);
        sentMessageId = sendResult.id;
      } catch {
        // Non-critical — just means future replies won't thread perfectly
      }

      // Update conversation with response (store without signature for clean display)
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
      });
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
