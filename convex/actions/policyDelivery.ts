"use node";

import { v } from "convex/values";
import { z } from "zod";
import dayjs from "dayjs";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { generateTextForOrg } from "../lib/models";
import {
  buildEmailPayload,
  buildEmailSignature,
  resolveEmailAgentIdentity,
  toResendAttachments,
  type EmailAttachmentMeta,
} from "../lib/emailSubagent";
import { sendResendEmail, getAgentDomain } from "../lib/resend";
import {
  sendIdempotentOutboundImessage,
  type ImessageOutboundAttachment,
} from "../lib/imessageOutbound";
import {
  ACORD_LOB_LABELS,
  policyLobCodes,
} from "../lib/linesOfBusiness";
import { deterministicRuleMatch } from "../lib/policyDeliveryMatching";

type Channel = "email" | "imessage";
type DeliveryAction = "auto_send" | "broker_review" | "do_not_send";
type DeliveryRule = Doc<"policyDeliveryRules">;

const llmDecisionSchema = z.object({
  matches: z.boolean(),
  reason: z.string().optional(),
});

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function lower(value: unknown) {
  return clean(value)?.toLowerCase() ?? "";
}

function hasOpenExtractionReview(policy: Doc<"policies">) {
  const review = policy.extractionReview;
  if (!review || typeof review !== "object") return false;
  const stack: unknown[] = [review];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    const status = lower(record.status);
    if (status === "open" || status === "needs_review" || status === "unanswered") {
      return true;
    }
    stack.push(...Object.values(record));
  }
  return false;
}

async function evaluateLlmRule(ctx: any, params: {
  orgId: Id<"organizations">;
  rule: DeliveryRule;
  policy: Doc<"policies">;
}) {
  if (!params.rule.llmRuleText?.trim()) return { matches: true, reason: "No LLM rule." };

  const prompt = `Decide whether a commercial insurance policy delivery rule matches this extracted policy.

Rule:
${params.rule.llmRuleText}

Policy:
${JSON.stringify({
    carrier: params.policy.carrier,
    security: params.policy.security,
    insurer: params.policy.insurer,
    underwriter: params.policy.underwriter,
    mga: params.policy.mga,
    programName: params.policy.programName,
    linesOfBusiness: policyLobCodes(params.policy).map((code) => ({
      code,
      label: ACORD_LOB_LABELS[code],
    })),
    coverages: params.policy.coverages?.map((coverage) => ({
      name: coverage.name,
      coverageCode: coverage.coverageCode,
      limit: coverage.limit,
    })),
    summary: params.policy.summary,
  }, null, 2)}

Respond only with JSON matching:
{"matches": true, "reason": "short reason"}`;

  const result = await generateTextForOrg(ctx, params.orgId, "classification", {
    maxOutputTokens: 220,
    messages: [{ role: "user", content: prompt }],
  });
  const json = result.text.match(/\{[\s\S]*\}/)?.[0] ?? result.text;
  return llmDecisionSchema.parse(JSON.parse(json));
}

async function chooseDecision(ctx: any, data: any): Promise<{
  action: DeliveryAction;
  channels: Channel[];
  rule?: DeliveryRule;
  summary: string;
  details?: Record<string, unknown>;
}> {
  const policy = data.policy as Doc<"policies">;
  const settings = data.clientSettings ?? data.brokerSettings;
  if (data.job.action === "auto_send" && data.job.decisionSummary && data.job.channels?.length) {
    return {
      action: "auto_send",
      channels: data.job.channels,
      summary: data.job.decisionSummary,
      details: data.job.decisionDetails,
    };
  }
  if (!settings?.enabled) {
    return {
      action: "do_not_send",
      channels: [],
      summary: "Policy delivery is disabled for this broker or client.",
    };
  }
  if (hasOpenExtractionReview(policy)) {
    return {
      action: "broker_review",
      channels: settings.channels,
      summary: "Extraction has open review questions, so delivery requires broker review.",
    };
  }
  for (const rule of data.rules as DeliveryRule[]) {
    if (!deterministicRuleMatch(rule, policy)) continue;
    try {
      const llm = await evaluateLlmRule(ctx, {
        orgId: data.client._id,
        rule,
        policy,
      });
      if (!llm.matches) continue;
      return {
        action: rule.action,
        channels: (rule.channels?.length ? rule.channels : settings.channels) as Channel[],
        rule,
        summary: llm.reason ?? `Matched rule "${rule.name}".`,
        details: { llmReason: llm.reason },
      };
    } catch (error) {
      return {
        action: "broker_review",
        channels: settings.channels,
        rule,
        summary: `Rule "${rule.name}" needs broker review because LLM evaluation failed.`,
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }
  return {
    action: settings.defaultAction as DeliveryAction,
    channels: settings.channels as Channel[],
    summary: "No delivery rule matched; using the default delivery action.",
  };
}

function resolveRecipient(data: any) {
  const client = data.client as Doc<"organizations">;
  const primary = data.primaryInsuranceContact as Doc<"users"> | null;
  const member = (data.members ?? []).find((row: any) => row.user?.email || row.user?.phone);
  return {
    name: clean(client.primaryContactName) ?? clean(primary?.name) ?? clean(member?.user?.name),
    email: clean(client.primaryContactEmail) ?? clean(primary?.email) ?? clean(member?.user?.email),
    phone: clean(client.primaryContactPhone) ?? clean(primary?.phone) ?? clean(member?.user?.phone),
  };
}

function sourceAttachment(data: any): EmailAttachmentMeta | null {
  const policy = data.policy as Doc<"policies">;
  const policyFile = data.policyFile as Doc<"policyFiles"> | null;
  const fileId = policyFile?.fileId ?? policy.fileId;
  if (!fileId) return null;
  return {
    fileId,
    filename: policyFile?.fileName ?? policy.fileName ?? `${policy.policyNumber || "policy"}.pdf`,
    contentType: "application/pdf",
    size: 0,
  };
}

function sourceLabel(data: any) {
  return data.job.sourceKind === "endorsement" ? "endorsement" : "policy";
}

async function buildDeliveryCopy(ctx: any, data: any, instructions?: string) {
  const policy = data.policy as Doc<"policies">;
  const broker = data.broker as Doc<"organizations">;
  const client = data.client as Doc<"organizations">;
  const label = sourceLabel(data);
  const fallbackSubject =
    label === "endorsement"
      ? `Policy endorsement for ${policy.policyNumber}`
      : `Your ${policy.carrier} policy ${policy.policyNumber}`;
  const fallbackBody = [
    `Hi ${client.primaryContactName?.trim() || "there"},`,
    "",
    `Attached is the ${label} for ${policy.insuredName || client.name}.`,
    "",
    `${policy.carrier || "Carrier"}${policy.policyNumber ? ` policy ${policy.policyNumber}` : ""}${policy.effectiveDate && policy.expirationDate ? ` is effective ${policy.effectiveDate} to ${policy.expirationDate}` : ""}.`,
    "",
    "Reply here with any questions. Glass will help answer using the policy documents, and your broker can review the conversation.",
  ].join("\n");
  if (!instructions?.trim()) return { subject: fallbackSubject, body: fallbackBody };

  try {
    const prompt = `Write concise commercial insurance delivery copy from a broker to a policyholder.

Use these variables:
Broker: ${broker.name}
Client org: ${client.name}
Recipient: ${client.primaryContactName ?? "policyholder"}
Document type: ${label}
Carrier: ${policy.carrier}
Policy number: ${policy.policyNumber}
Insured: ${policy.insuredName}
Effective date: ${policy.effectiveDate}
Expiration date: ${policy.expirationDate}
Broker instructions:
${instructions}

Requirements:
- Mention the attached PDF.
- Make clear the recipient can reply in this same thread with questions.
- Keep it professional and brief.
- Do not include a sign-off.

Respond only with JSON: {"subject":"...","body":"..."}`;
    const result = await generateTextForOrg(ctx, client._id, "email_draft", {
      maxOutputTokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? result.text);
    return {
      subject: clean(parsed.subject) ?? fallbackSubject,
      body: clean(parsed.body) ?? fallbackBody,
    };
  } catch {
    return { subject: fallbackSubject, body: fallbackBody };
  }
}

function availableChannels(requested: Channel[], settingsChannels: Channel[], recipient: {
  email?: string;
  phone?: string;
}) {
  const result: Channel[] = [];
  for (const channel of requested) {
    if (channel === "email" && recipient.email) result.push("email");
    if (channel === "imessage" && recipient.phone) result.push("imessage");
  }
  if (result.length === requested.length) return [...new Set(result)];
  for (const channel of settingsChannels) {
    if (channel === "email" && recipient.email && !result.includes("email")) result.push("email");
    if (channel === "imessage" && recipient.phone && !result.includes("imessage")) result.push("imessage");
  }
  return result;
}

async function insertAttempt(ctx: any, data: any, args: {
  channel: Channel;
  status: "sent" | "failed" | "skipped";
  messageId?: string;
  error?: string;
}) {
  await ctx.runMutation((internal as any).policyDelivery.insertAttemptInternal, {
    jobId: data.job._id,
    brokerOrgId: data.job.brokerOrgId,
    clientOrgId: data.job.clientOrgId,
    policyId: data.job.policyId,
    ...args,
  });
}

export const processJob = internalAction({
  args: { jobId: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery((internal as any).policyDelivery.getContextInternal, {
      jobId: args.jobId,
    });
    if (!data?.job || !data.policy || !data.client || !data.broker) return;
    if (!["queued", "failed"].includes(data.job.status)) return;

    const settings = data.clientSettings ?? data.brokerSettings;
    const decision = await chooseDecision(ctx, data);
    const recipient = resolveRecipient(data);
    const attachment = sourceAttachment(data);
    const basePatch = {
      action: decision.action,
      channels: decision.channels,
      ruleId: decision.rule?._id,
      ruleName: decision.rule?.name,
      decisionSummary: decision.summary,
      decisionDetails: decision.details,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      recipientPhone: recipient.phone,
    };

    if (!settings?.deliverBeforeClientAcceptance && (data.client.inviteStatus || !data.client.onboardingComplete)) {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "blocked",
        lastError: "Client delivery before invite acceptance is disabled.",
      });
      return;
    }
    if (decision.action === "do_not_send") {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "suppressed",
      });
      return;
    }
    if (decision.action === "broker_review") {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "review_required",
      });
      return;
    }
    if (!attachment) {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "blocked",
        lastError: "No policy PDF attachment is available.",
      });
      return;
    }

    const channels = availableChannels(decision.channels, settings?.channels ?? [], recipient);
    if (channels.length === 0) {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "blocked",
        lastError: "No enabled delivery channel has usable contact details.",
      });
      return;
    }

    const userId = data.uploadedBy?._id ?? data.fallbackUserId;
    if (!userId) {
      await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
        id: args.jobId,
        ...basePatch,
        status: "blocked",
        lastError: "No broker user is available to own the delivery thread.",
      });
      return;
    }

    const contactKey = `policy-delivery:${(recipient.email ?? recipient.phone ?? data.client._id).toLowerCase()}`;
    const threadId = await ctx.runMutation((internal as any).threads.findOrCreateForDeliveryContact, {
      orgId: data.client._id,
      userId,
      contactKey,
      title: `Policy delivery - ${recipient.name || data.client.name}`,
      email: recipient.email,
      phone: recipient.phone,
      agentDomain: getAgentDomain(),
    });
    const copyInstructions = decision.rule?.copyInstructions ?? settings?.copyInstructions;
    const copy = await buildDeliveryCopy(ctx, data, copyInstructions);

    await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
      id: args.jobId,
      ...basePatch,
      channels,
      threadId,
      status: "sending",
    });

    let emailSent = false;
    let imessageSent = false;
    let lastError: string | undefined;

    if (channels.includes("email") && recipient.email) {
      try {
        const identity = await resolveEmailAgentIdentity(ctx, data.client);
        if (!identity.canSend || !identity.fromHeader || !identity.agentAddress) {
          throw new Error(identity.reason ?? "Email sender is not configured.");
        }
        const signature = buildEmailSignature(identity.agentAddress, identity.brokerBranding);
        const outboundMessageId = `<glass-policy-delivery-${args.jobId}@${getAgentDomain()}>`;
        const emailPayload = buildEmailPayload({
          fromHeader: identity.fromHeader,
          to: recipient.email,
          cc: [],
          bcc: [],
          subject: copy.subject,
          body: copy.body,
          signature,
        });
        emailPayload.headers = {
          ...((emailPayload.headers as Record<string, string> | undefined) ?? {}),
          "Message-ID": outboundMessageId,
        };
        emailPayload.attachments = await toResendAttachments(ctx, [attachment]);
        const result = await sendResendEmail(emailPayload as Parameters<typeof sendResendEmail>[0], {
          retries: 2,
        });
        if (!result.ok) throw new Error(result.error);
        emailSent = true;
        await insertAttempt(ctx, data, {
          channel: "email",
          status: "sent",
          messageId: result.id,
        });
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId,
          orgId: data.client._id,
          role: "agent",
          fromEmail: identity.agentAddress,
          fromName: identity.brokerBranding?.agentDisplayName ?? identity.brokerBranding?.name ?? "Glass",
          toAddresses: [recipient.email],
          subject: copy.subject,
          content: copy.body,
          messageId: outboundMessageId,
          responseMessageId: result.id,
          resendEmailId: result.id,
          attachments: [attachment],
          referencedPolicyIds: [data.policy._id],
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await insertAttempt(ctx, data, { channel: "email", status: "failed", error: lastError });
      }
    }

    if (channels.includes("imessage") && recipient.phone) {
      try {
        const url = await ctx.storage.getUrl(attachment.fileId);
        if (!url) throw new Error("Policy PDF URL is not available.");
        const imessageAttachment: ImessageOutboundAttachment = {
          url,
          filename: attachment.filename,
          mimeType: attachment.contentType,
        };
        const ok = await sendIdempotentOutboundImessage(ctx, {
          idempotencyKey: `${data.job.idempotencyKey}:imessage`,
          orgId: data.client._id,
          threadId,
          toPhone: recipient.phone,
          message: copy.body,
          attachments: [imessageAttachment],
          logPrefix: "policyDelivery",
        });
        if (!ok) throw new Error("iMessage worker send failed or is not configured.");
        imessageSent = true;
        await insertAttempt(ctx, data, { channel: "imessage", status: "sent" });
        await ctx.runMutation(internal.threads.insertImessageMessage, {
          threadId,
          orgId: data.client._id,
          role: "agent",
          content: copy.body,
          responseMessageId: `${args.jobId}:imessage`,
          attachments: [attachment],
          referencedPolicyIds: [data.policy._id],
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await insertAttempt(ctx, data, { channel: "imessage", status: "failed", error: lastError });
      }
    }

    const sentCount = Number(emailSent) + Number(imessageSent);
    const status =
      sentCount === channels.length
        ? "sent"
        : sentCount > 0
          ? "partially_sent"
          : "failed";
    await ctx.runMutation((internal as any).policyDelivery.patchJobInternal, {
      id: args.jobId,
      status,
      emailSentAt: emailSent ? dayjs().valueOf() : undefined,
      imessageSentAt: imessageSent ? dayjs().valueOf() : undefined,
      sentAt: sentCount > 0 ? dayjs().valueOf() : undefined,
      lastError,
    });
  },
});
