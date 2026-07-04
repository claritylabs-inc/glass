"use node";

import { createHash } from "node:crypto";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  getModelAndRouteForPublicTask,
  getProviderOptionsForRoute,
  type ModelTask,
} from "../lib/models";
import { markdownToHtml, stripMarkdown } from "../lib/aiUtils";
import {
  buildAgentEmailHtmlBody,
  buildEmailSignature,
} from "../lib/emailSubagent";
import {
  buildPublicDemoBookingUrl,
  buildPublicDemoSystemPrompt,
  looksLikeBookingIntent,
  publicDemoNeedsTextEmail,
  PUBLIC_DEMO_BOOKING_URL,
  PUBLIC_DEMO_EXAMPLE_DATA,
  PUBLIC_DEMO_SIGNUP_URL,
  type PublicDemoChannel,
  type PublicDemoCtaStatus,
  type PublicDemoLeadContext,
  type PublicDemoLeadStage,
} from "../lib/publicDemoAgent";

type PublicDemoConversation = {
  _id: Id<"publicDemoConversations">;
  channel: PublicDemoChannel;
  senderContact?: string;
  leadName?: string;
  leadCompany?: string;
  leadEmail?: string;
  leadUseCase?: string;
  stage: PublicDemoLeadStage;
  ctaStatus: PublicDemoCtaStatus;
  turnCount: number;
};

type PublicDemoLog = {
  direction: "inbound" | "outbound" | "system";
  content: string;
  createdAt: number;
  subject?: string;
};

type PublicDemoAgentResponse = {
  conversationId: Id<"publicDemoConversations">;
  outboundLogId: Id<"publicDemoChatLogs">;
  text: string;
  html: string;
  ctaUrl?: string;
  route?: { provider: string; model: string };
  routeSource?: string;
};

function senderHash(channel: PublicDemoChannel, senderContact: string) {
  return createHash("sha256")
    .update(`${channel}:${senderContact.trim().toLowerCase()}`)
    .digest("hex");
}

function compact(value: string | undefined) {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
}

function mergeLead(
  conversation: PublicDemoConversation,
  patch: PublicDemoLeadContext,
): PublicDemoLeadContext {
  return {
    name: compact(patch.name) ?? conversation.leadName,
    company: compact(patch.company) ?? conversation.leadCompany,
    email: compact(patch.email) ?? conversation.leadEmail,
    useCase: compact(patch.useCase) ?? conversation.leadUseCase,
  };
}

function logsToMessages(logs: PublicDemoLog[]): ModelMessage[] {
  return logs
    .filter((log) => log.direction !== "system")
    .slice(-10)
    .map((log) => ({
      role: log.direction === "inbound" ? "user" : "assistant",
      content:
        log.direction === "inbound" && log.subject
          ? `Subject: ${log.subject}\n\n${log.content}`
          : log.content,
    }));
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return undefined;
  }
}

function collectToolAudit(result: unknown) {
  const calls: Array<{ name: string; input?: string; output?: string }> = [];
  const add = (part: unknown, output?: unknown) => {
    if (!part || typeof part !== "object") return;
    const record = part as Record<string, unknown>;
    const name =
      typeof record.toolName === "string"
        ? record.toolName
        : typeof record.name === "string"
          ? record.name
          : undefined;
    if (!name) return;
    calls.push({
      name,
      input: safeJson(record.input ?? record.args),
      output: safeJson(output ?? record.output ?? record.result),
    });
  };

  const root = result as Record<string, unknown>;
  if (Array.isArray(root.toolCalls)) {
    for (const call of root.toolCalls) add(call);
  }
  if (Array.isArray(root.steps)) {
    for (const step of root.steps) {
      const stepRecord = step as Record<string, unknown>;
      if (Array.isArray(stepRecord.toolCalls)) {
        for (const call of stepRecord.toolCalls) add(call);
      }
      if (Array.isArray(stepRecord.toolResults)) {
        for (const toolResult of stepRecord.toolResults) add(toolResult);
      }
    }
  }
  return calls.slice(0, 20);
}

function inferStage(args: {
  current: PublicDemoLeadStage;
  message: string;
  ctaStatus: PublicDemoCtaStatus;
  lead: PublicDemoLeadContext;
}): PublicDemoLeadStage {
  if (args.ctaStatus === "cal_link_sent") return "cta_sent";
  if (args.ctaStatus === "signup_link_sent") return "signup_intent";
  if (looksLikeBookingIntent(args.message)) return "booking_intent";
  if (args.lead.name && args.lead.company) return "qualified";
  if (args.current === "new") return "engaged";
  return args.current;
}

function extractObjections(logs: PublicDemoLog[]) {
  const text = logs.map((log) => log.content).join("\n").toLowerCase();
  return [
    /\b(price|pricing|cost|expensive)\b/.test(text) ? "Pricing" : undefined,
    /\b(security|privacy|data|soc|compliance)\b/.test(text)
      ? "Security or data handling"
      : undefined,
    /\b(real|binding|valid|certificate|coi)\b/.test(text)
      ? "Certificate validity"
      : undefined,
    /\b(integration|api|mailbox|email|imap)\b/.test(text)
      ? "Integration workflow"
      : undefined,
  ].filter((item): item is string => Boolean(item));
}

function transcriptSummary(args: {
  lead: PublicDemoLeadContext;
  stage: PublicDemoLeadStage;
  ctaStatus: PublicDemoCtaStatus;
  latestMessage: string;
}) {
  const who = [
    args.lead.name ?? "Unknown prospect",
    args.lead.company ? `from ${args.lead.company}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const useCase = args.lead.useCase
    ? ` They are exploring ${args.lead.useCase}.`
    : "";
  return `${who} contacted the public Glass demo agent. Stage: ${args.stage}. CTA: ${args.ctaStatus}.${useCase} Latest user message: ${args.latestMessage.slice(0, 240)}`;
}

function nextStep(stage: PublicDemoLeadStage, ctaStatus: PublicDemoCtaStatus) {
  if (ctaStatus === "cal_link_sent") return "Watch for Cal.com booking completion or follow up from the transcript.";
  if (ctaStatus === "asked_for_email") return "Ask for the prospect's email so the Cal.com link can be prefilled.";
  if (stage === "booking_intent") return "Send the Cal.com product demo link once email is available if needed.";
  if (stage === "qualified") return "Continue demo and steer toward booking a product demo.";
  return "Continue demo, capture name/company, and qualify use case.";
}

function hasSafetyNotice(text: string) {
  return /\b(demo only|demo data only|not real|not binding|no certificate (?:was )?issued|not insurance advice)\b/i.test(
    text,
  );
}

function hasPriorSafetyNotice(logs: PublicDemoLog[]) {
  return logs.some(
    (log) => log.direction === "outbound" && hasSafetyNotice(log.content),
  );
}

function removeRepeatedSafetyFooter(text: string) {
  return text
    .replace(/\s*Demo data only, not real advice\.?/gi, "")
    .replace(/\s*Demo only[:.] No real certificate or insurance advice\.?/gi, "")
    .replace(
      /\s*Demo only: no certificate was issued, and this is not insurance advice\.?/gi,
      "",
    )
    .replace(
      /\s*Demo only: no certificate was issued, nothing here is binding, and this is not insurance advice\.?/gi,
      "",
    )
    .split("\n")
    .filter(
      (line) =>
        !/^\s*demo only[:.]/i.test(line) &&
        !/\bno certificate (?:was )?issued\b/i.test(line),
    )
    .join("\n")
    .trim();
}

function flattenImessageText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[“”]/g, '"')
    .trim();
}

function conciseImessageFallback(args: {
  text: string;
  latestMessage: string;
}) {
  const combined = `${args.latestMessage}\n${args.text}`.toLowerCase();
  let text = args.text;

  if (/\b(what can|what does).*\bglass\b|\bglass do\b/.test(combined)) {
    text =
      "Glass can read insurance docs/emails, spot gaps, and draft follow-ups. Want COIs, renewals, or vendor compliance?";
  } else if (/\b(coi|certificate|cert|proof of insurance)\b/.test(combined)) {
    text = "Glass can draft the COI request and broker follow-up.";
  } else if (/\b(vendor|compliance|requirement)\b/.test(combined)) {
    text = "Glass can check vendor evidence against requirements and flag gaps.";
  } else if (/\b(email|inbox|mailbox|renewal|follow[- ]?up)\b/.test(combined)) {
    text = "Glass can find policy emails, pull the key details, and draft the follow-up.";
  } else {
    text = args.text.split(/(?<=[.!?])\s+/)[0] ?? args.text;
  }

  return text;
}

function normalizeEmailResponse(text: string) {
  return text
    .trim()
    .replace(/\s+-\s+(?=[A-Z0-9])/g, "\n- ")
    .replace(/:\n(- )/g, ":\n\n$1")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeChannelResponse(args: {
  text: string;
  channel: PublicDemoChannel;
  latestMessage: string;
}) {
  if (args.channel === "email") {
    return normalizeEmailResponse(args.text);
  }

  const flattened = flattenImessageText(args.text)
    .replace(/^hi\s+[^,!.—-]+[,!—-]\s*/i, "")
    .replace(/\bhere(?:'|’)s a simulated example\b[:\s-]*/i, "")
    .replace(/\bwant the matching sample [^?]+\?/gi, "")
    .trim();
  const artifactLike =
    /\b(sample COI text block|COI delivery email|simulated Glass demo email|no certificate issued\/attached|no certificate was issued or attached)\b/i.test(
      flattened,
    );

  if (flattened.length <= 240 && !artifactLike) return flattened;
  return conciseImessageFallback({
    text: flattened,
    latestMessage: args.latestMessage,
  });
}

function addSimulationNotice(args: {
  text: string;
  channel: PublicDemoChannel;
  alreadyWarned: boolean;
}) {
  const text = removeRepeatedSafetyFooter(args.text) || args.text.trim();
  if (args.alreadyWarned) {
    return text;
  }
  const notice =
    args.channel === "imessage"
      ? "Demo data only, not real advice."
      : "Demo only: no certificate was issued, nothing here is binding, and this is not insurance advice.";
  const separator = args.channel === "imessage" ? " " : "\n\n";
  return `${text}${separator}${notice}`;
}

function formatPublicDemoEmail(args: {
  body: string;
  agentAddress?: string;
}): { text: string; html: string } {
  const signature = buildEmailSignature(args.agentAddress ?? "agent@glass.insure");
  const text = stripMarkdown(args.body) + signature.text;
  const html = buildAgentEmailHtmlBody(args.body, signature);
  return { text, html };
}

function mentionsRealOrAdviceRisk(text: string) {
  return /\b(real|valid|binding|official|certified|usable|issued|attached|proof of insurance|insurance advice|legal advice)\b/i.test(
    text,
  );
}

function mentionsRealLookingDemoArtifact(text: string) {
  return (
    /\b(sample|example|simulated|draft)\b.{0,80}\b(coi|certificate|policy answer|coverage answer|compliance result|email)\b/i.test(
      text,
    ) ||
    /\b(policy number|carrier|limit|additional insured|waiver of subrogation|certificate holder|covered|not covered|compliant|noncompliant|needs attention)\b/i.test(
      text,
    )
  );
}

function shouldAttachSimulationNotice(args: {
  channel: PublicDemoChannel;
  latestMessage: string;
  responseText: string;
  alreadyWarned: boolean;
}) {
  if (args.alreadyWarned) return false;
  const combined = `${args.latestMessage}\n${args.responseText}`;
  if (mentionsRealOrAdviceRisk(combined)) return true;
  if (args.channel === "email") {
    return mentionsRealLookingDemoArtifact(args.responseText);
  }
  return mentionsRealLookingDemoArtifact(args.responseText);
}

export const respond = internalAction({
  args: {
    channel: v.union(v.literal("email"), v.literal("imessage")),
    senderContact: v.string(),
    messageText: v.string(),
    subject: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    agentAddress: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    chatGuid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublicDemoAgentResponse> => {
    const channel = args.channel as PublicDemoChannel;
    const normalizedSender = args.senderContact.trim().toLowerCase();
    const rateKey = senderHash(channel, normalizedSender);
    const rate = await ctx.runMutation(internal.publicDemo.checkRateLimit, {
      rateKey,
    });

    const conversation = (await ctx.runMutation(
      internal.publicDemo.findOrCreateConversation,
      {
        channel,
        senderHash: rateKey,
        senderContact: args.senderContact,
        agentAddress: args.agentAddress,
        leadEmail: channel === "email" ? args.fromEmail : undefined,
      },
    )) as PublicDemoConversation;

    await ctx.runMutation(internal.publicDemo.appendChatLog, {
      conversationId: conversation._id,
      channel,
      direction: "inbound",
      subject: args.subject,
      content: args.messageText,
      deliveryStatus: "received",
      metadata: {
        fromName: args.fromName,
        fromEmail: args.fromEmail,
        sourceMessageId: args.sourceMessageId,
        resendEmailId: args.resendEmailId,
        chatGuid: args.chatGuid,
      },
    });

    if (!rate.allowed) {
      const text =
        channel === "imessage"
          ? "I am getting a lot of demo messages from this contact. Please try again in a few minutes, or book here: https://cal.com/team/claritylabs/product-demo"
          : "I am getting a lot of demo messages from this contact. Please try again in a few minutes, or book a product demo at https://cal.com/team/claritylabs/product-demo.";
      const formatted =
        channel === "email"
          ? formatPublicDemoEmail({ body: text, agentAddress: args.agentAddress })
          : { text, html: markdownToHtml(text) };
      await ctx.runMutation(internal.publicDemo.updateConversationLead, {
        conversationId: conversation._id,
        stage: "rate_limited",
      });
      const outboundLogId = (await ctx.runMutation(
        internal.publicDemo.appendChatLog,
        {
          conversationId: conversation._id,
          channel,
          direction: "outbound",
          subject: args.subject,
          content: text,
          contentHtml: formatted.html,
          deliveryStatus: "generated",
        },
      )) as Id<"publicDemoChatLogs">;
      return {
        conversationId: conversation._id,
        outboundLogId,
        text: formatted.text,
        html: formatted.html,
      };
    }

    const logs = (await ctx.runQuery(
      internal.publicDemo.listConversationLogsInternal,
      {
        conversationId: conversation._id,
        limit: 16,
      },
    )) as PublicDemoLog[];
    const alreadyWarned = hasPriorSafetyNotice(logs);
    const leadPatch: PublicDemoLeadContext = {};
    let ctaStatus: PublicDemoCtaStatus = conversation.ctaStatus;
    let ctaUrl: string | undefined;
    const initialLead = mergeLead(conversation, {
      email: channel === "email" ? args.fromEmail : undefined,
    });
    const task: ModelTask = channel === "email" ? "email_reply" : "chat";
    const routed = await getModelAndRouteForPublicTask(ctx, task);

    const tools = {
      record_lead_context: tool({
        description:
          "Record prospect name, company, email, or use case when the prospect provides it. Use this before tailoring examples.",
        inputSchema: z.object({
          name: z.string().optional(),
          company: z.string().optional(),
          email: z.string().email().optional(),
          useCase: z.string().optional(),
        }),
        execute: async (input) => {
          if (input.name) leadPatch.name = input.name;
          if (input.company) leadPatch.company = input.company;
          if (input.email) leadPatch.email = input.email;
          if (input.useCase) leadPatch.useCase = input.useCase;
          return { recorded: true };
        },
      }),
      answer_example_policy_question: tool({
        description:
          "Answer a policy question using the simulated Clarity Labs policy data. This is not real insurance advice.",
        inputSchema: z.object({
          question: z.string(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Glass would pull the policy details and answer from the evidence.",
                example:
                  "Clarity Labs has example GL and Cyber policies in the demo data.",
                note: "Demo data only.",
              }
            : {
                company: PUBLIC_DEMO_EXAMPLE_DATA.company,
                address: PUBLIC_DEMO_EXAMPLE_DATA.address,
                policies: PUBLIC_DEMO_EXAMPLE_DATA.policies,
                note: "Simulated demo data only. Not a real policy answer or insurance advice.",
              },
      }),
      check_example_vendor_compliance: tool({
        description:
          "Run a simulated vendor compliance check with example requirements and policy evidence.",
        inputSchema: z.object({
          vendorName: z.string().optional(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Glass would check the vendor evidence and flag missing cyber plus AI wording.",
                note: "Demo data only.",
              }
            : {
                vendor: PUBLIC_DEMO_EXAMPLE_DATA.vendor.name,
                status: PUBLIC_DEMO_EXAMPLE_DATA.vendor.status,
                gaps: PUBLIC_DEMO_EXAMPLE_DATA.vendor.gaps,
                note: "Simulated demo result only. Glass would use connected vendor policies and saved requirements for a real customer.",
              },
      }),
      draft_example_certificate_email: tool({
        description:
          "Draft a simulated certificate or COI delivery email. Do not claim the certificate is real, binding, or issued.",
        inputSchema: z.object({
          recipient: z.string().optional(),
          request: z.string().optional(),
        }),
        execute: async (input) =>
          channel === "imessage"
            ? {
                summary:
                  "Glass can draft the COI request and broker follow-up.",
                note: "Demo data only. No COI is issued.",
              }
            : {
                subject: "Example certificate follow-up",
                body: [
                  `Hi ${input.recipient ?? "there"},`,
                  "",
                  "This is a simulated Glass demo email. In a real workspace, Glass would prepare the certificate request from policy evidence, flag endorsements that need review, and route the draft for send confirmation.",
                  "",
                  "Demo note: no certificate was issued or attached.",
                ].join("\n"),
              },
      }),
      explain_mailbox_agent: tool({
        description:
          "Explain how the Glass mailbox agent can search insurance emails and coordinate follow-up.",
        inputSchema: z.object({
          task: z.string().optional(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Glass can find policy emails, pull key details, and draft the follow-up.",
              }
            : {
                workflow: [
                  "Search connected insurance mailboxes for policies, renewals, endorsements, and requirement packets.",
                  "Read bounded message and attachment content.",
                  "Import selected documents into first-class policy or compliance workflows after user confirmation.",
                  "Draft follow-up with evidence and send confirmation visible in Glass.",
                ],
              },
      }),
      build_demo_booking_link: tool({
        description:
          "Build the Cal.com product-demo link once the prospect is ready to book. For text/iMessage, ask for email first if missing.",
        inputSchema: z.object({
          notes: z.string().optional(),
        }),
        execute: async (input) => {
          const lead = mergeLead(conversation, leadPatch);
          if (channel === "imessage" && !lead.email) {
            ctaStatus = "asked_for_email";
            return {
              needsEmail: true,
              message: "Ask for the best email before sending the prefilled Cal.com link.",
            };
          }
          ctaStatus = "cal_link_sent";
          ctaUrl = buildPublicDemoBookingUrl({
            channel,
            lead,
            notes: input.notes,
          });
          return {
            bookingUrl: ctaUrl,
            signupUrl: PUBLIC_DEMO_SIGNUP_URL,
          };
        },
      }),
    };

    const system = buildPublicDemoSystemPrompt({
      channel,
      lead: initialLead,
      turnCount: conversation.turnCount,
      latestMessage: args.messageText,
      hasSentSafetyNotice: alreadyWarned,
    });
    const messages = [
      ...logsToMessages(logs.slice(0, -1)),
      {
        role: "user" as const,
        content: args.subject
          ? `Subject: ${args.subject}\n\n${args.messageText}`
          : args.messageText,
      },
    ];

    const result = await generateText({
      model: routed.model,
      providerOptions: getProviderOptionsForRoute(routed.route),
      maxOutputTokens: channel === "imessage" ? 120 : 700,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(5),
    });

    let responseText = result.text.trim();
    const lead = mergeLead(conversation, leadPatch);
    const needsTextEmail = publicDemoNeedsTextEmail({
      channel,
      lead,
      latestMessage: args.messageText,
    });
    if (needsTextEmail && ctaStatus !== "cal_link_sent") {
      ctaStatus = "asked_for_email";
    }
    const nextStage = inferStage({
      current: conversation.stage,
      message: args.messageText,
      ctaStatus,
      lead,
    });
    if (!responseText) {
      responseText =
        channel === "imessage"
          ? "I can show a quick Glass demo with example policy data. What should I walk through?"
          : "I can show a quick Glass demo with example policy data. Reply with the workflow you want to see, such as policy Q&A, vendor compliance, mailbox search, or certificate drafting.";
    }
    if (needsTextEmail && responseText.includes(PUBLIC_DEMO_BOOKING_URL)) {
      responseText =
        "What is the best email to prefill on the product-demo booking link?";
    }
    responseText = normalizeChannelResponse({
      text: responseText,
      channel,
      latestMessage: args.messageText,
    });
    if (
      shouldAttachSimulationNotice({
        channel,
        latestMessage: args.messageText,
        responseText,
        alreadyWarned,
      })
    ) {
      responseText = addSimulationNotice({
        text: responseText,
        channel,
        alreadyWarned,
      });
    } else if (channel === "imessage") {
      responseText = removeRepeatedSafetyFooter(responseText) || responseText;
    }

    await ctx.runMutation(internal.publicDemo.updateConversationLead, {
      conversationId: conversation._id,
      leadName: lead.name,
      leadCompany: lead.company,
      leadEmail: lead.email,
      leadUseCase: lead.useCase,
      stage: nextStage,
      ctaStatus,
    });
    const toolCalls = collectToolAudit(result);
    const formatted =
      channel === "email"
        ? formatPublicDemoEmail({
            body: responseText,
            agentAddress: args.agentAddress,
          })
        : { text: responseText, html: markdownToHtml(responseText) };
    const outboundLogId = (await ctx.runMutation(
      internal.publicDemo.appendChatLog,
      {
        conversationId: conversation._id,
        channel,
        direction: "outbound",
        subject: args.subject,
        content: responseText,
        contentHtml: formatted.html,
        modelProvider: routed.route.provider,
        model: routed.route.model,
        routeSource: routed.routeSource,
        transport: routed.transport,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ctaUrl,
        deliveryStatus: "generated",
      },
    )) as Id<"publicDemoChatLogs">;

    const latestLogs = (await ctx.runQuery(
      internal.publicDemo.listConversationLogsInternal,
      {
        conversationId: conversation._id,
        limit: 20,
      },
    )) as PublicDemoLog[];
    await ctx.runMutation(internal.publicDemo.upsertSalesTranscript, {
      conversationId: conversation._id,
      channel,
      senderContact: args.senderContact,
      leadName: lead.name,
      leadCompany: lead.company,
      leadEmail: lead.email,
      leadUseCase: lead.useCase,
      stage: nextStage,
      ctaStatus,
      summary: transcriptSummary({
        lead,
        stage: nextStage,
        ctaStatus,
        latestMessage: args.messageText,
      }),
      objections: extractObjections(latestLogs),
      nextStep: nextStep(nextStage, ctaStatus),
      curatedTurns: latestLogs.slice(-8).map((log) => ({
        speaker: log.direction === "inbound" ? "Prospect" : "Glass demo agent",
        content: stripMarkdown(log.content).slice(0, 1200),
        at: log.createdAt,
      })),
    });

    return {
      conversationId: conversation._id,
      outboundLogId,
      text: formatted.text,
      html: formatted.html,
      ctaUrl,
      route: routed.route,
      routeSource: routed.routeSource,
    };
  },
});
