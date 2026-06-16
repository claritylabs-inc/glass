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
      ? "Certificate authority"
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

function addSimulationNotice(text: string, channel: PublicDemoChannel) {
  if (
    /\b(simulated|demo only|not real|not binding|no certificate was issued|not insurance advice)\b/i.test(
      text,
    )
  ) {
    return text;
  }
  const notice =
    channel === "imessage"
      ? "Demo only: no certificate was issued, and this is not insurance advice."
      : "Demo only: no certificate was issued, nothing here is binding, and this is not insurance advice.";
  return `${text.trim()}\n\n${notice}`;
}

function mentionsRegulatedDemoTopic(text: string) {
  return /\b(certificate|coi|proof of insurance|policy|coverage|compliance|advice|insured|endorsement)\b/i.test(
    text,
  );
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
          contentHtml: markdownToHtml(text),
          deliveryStatus: "generated",
        },
      )) as Id<"publicDemoChatLogs">;
      return {
        conversationId: conversation._id,
        outboundLogId,
        text,
        html: markdownToHtml(text),
      };
    }

    const logs = (await ctx.runQuery(
      internal.publicDemo.listConversationLogsInternal,
      {
        conversationId: conversation._id,
        limit: 16,
      },
    )) as PublicDemoLog[];
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
        execute: async () => ({
          company: PUBLIC_DEMO_EXAMPLE_DATA.company,
          address: PUBLIC_DEMO_EXAMPLE_DATA.address,
          policies: PUBLIC_DEMO_EXAMPLE_DATA.policies,
          note: "Simulated demo data only. Not a real policy answer or insurance advice.",
        }),
      }),
      check_example_vendor_compliance: tool({
        description:
          "Run a simulated vendor compliance check with example requirements and policy evidence.",
        inputSchema: z.object({
          vendorName: z.string().optional(),
        }),
        execute: async () => ({
          vendor: PUBLIC_DEMO_EXAMPLE_DATA.vendor.name,
          status: PUBLIC_DEMO_EXAMPLE_DATA.vendor.status,
          gaps: PUBLIC_DEMO_EXAMPLE_DATA.vendor.gaps,
          note: "Simulated demo result only. Glass would use connected vendor policies and saved requirements for a real customer.",
        }),
      }),
      draft_example_certificate_email: tool({
        description:
          "Draft a simulated certificate or COI delivery email. Do not claim the certificate is real, binding, or issued.",
        inputSchema: z.object({
          recipient: z.string().optional(),
          request: z.string().optional(),
        }),
        execute: async (input) => ({
          subject: "Example certificate follow-up",
          body: [
            `Hi ${input.recipient ?? "there"},`,
            "",
            "This is a simulated Glass demo email. In a real workspace, Glass would prepare the certificate request from policy evidence, flag endorsements that need review, and route the draft for approval before sending.",
            "",
            "Demo note: no certificate was issued or attached.",
          ].join("\n"),
        }),
      }),
      explain_mailbox_agent: tool({
        description:
          "Explain how the Glass mailbox agent can search insurance emails and coordinate follow-up.",
        inputSchema: z.object({
          task: z.string().optional(),
        }),
        execute: async () => ({
          workflow: [
            "Search connected insurance mailboxes for policies, renewals, endorsements, and requirement packets.",
            "Read bounded message and attachment content.",
            "Import selected documents into first-class policy or compliance workflows after user confirmation.",
            "Draft follow-up with evidence and approvals visible in Glass.",
          ],
        }),
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
      maxOutputTokens: channel === "imessage" ? 512 : 900,
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
    if (mentionsRegulatedDemoTopic(`${args.messageText}\n${responseText}`)) {
      responseText = addSimulationNotice(responseText, channel);
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
    const html = markdownToHtml(responseText);
    const outboundLogId = (await ctx.runMutation(
      internal.publicDemo.appendChatLog,
      {
        conversationId: conversation._id,
        channel,
        direction: "outbound",
        subject: args.subject,
        content: responseText,
        contentHtml: html,
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
      text: responseText,
      html,
      ctaUrl,
      route: routed.route,
      routeSource: routed.routeSource,
    };
  },
});
