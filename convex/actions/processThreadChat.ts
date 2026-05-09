"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { streamText, stepCountIs } from "ai";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  saveNote,
  generateCoi,
  createPolicyChangeRequest,
} from "../lib/chatTools";
import { buildDocumentContext, buildConversationMemoryContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  buildSignature,
  stripMarkdown,
  markdownToHtml,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  policySearchScore,
  logAiError,
} from "../lib/aiUtils";
import { searchPolicyDocumentWithSourceSpans } from "../lib/policyLookup";
import { sendResendEmail } from "../lib/resend";
import {
  buildEmailExpertTool,
  getEmailAgentFromName,
  resolveEmailAgentIdentity,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { buildIntelligenceContext } from "../lib/agentPrompts";
import {
  classifyPromptInjection,
  validateEmailRecipient,
  collectAllowedRecipients,
  assertOrgOwnership,
  enforceInputLimits,
} from "../lib/security";
import {
  COI_GENERATION_FAILED_MESSAGE,
  FATAL_ACTION_FAILED_MESSAGE,
} from "../lib/actionFailures";

/** Build executable tools with Convex context wired in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTools(ctx: any, args: { orgId: string; threadId: string; userId: string }, org?: Record<string, unknown>) {
  return {
    lookup_policy: {
      ...lookupPolicy,
      execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
        const policies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        const scored = policies
          .map((p: Record<string, unknown>) => ({
            policy: p,
            score: policySearchScore(p, params.query, params.policyType, params.carrier),
          }))
          .filter((p: { score: number }) => p.score > 0)
          .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
        const matches = scored.length > 0
          ? scored.map((s: { policy: Record<string, unknown> }) => s.policy)
          : policies.slice(0, 5);
        if (matches.length === 0) return "No policies found for this organization.";
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
          coverages: (p.coverages ?? []).map((c: any) => ({
            name: c.name,
            limit: c.limit,
            deductible: c.deductible,
          })),
        }));
      },
    },
    compare_coverages: {
      ...compareCoverages,
      execute: async (params: { policyId1: string; policyId2: string }) => {
        const policies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        const p1 = policies.find((p: Record<string, unknown>) => p._id === params.policyId1);
        const p2 = policies.find((p: Record<string, unknown>) => p._id === params.policyId2);
        if (!p1 || !p2) return "One or both policies not found.";
        const mapPolicy = (p: any) => ({
          id: p._id, carrier: p.security, type: p.policyTypes, limits: p.limits, deductibles: p.deductibles, premium: p.premium,
          coverages: (p.coverages ?? []).map((c: any) => ({ name: c.name, limit: c.limit, deductible: c.deductible })),
        });
        return { policy1: mapPolicy(p1), policy2: mapPolicy(p2) };
      },
    },
    lookup_policy_section: {
      ...lookupPolicySection,
      execute: async (params: { policyId: string; query: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const policy: any = await ctx.runQuery(
          internal.policies.getInternal,
          { id: params.policyId },
        );
        // Enforce org ownership — prevent cross-org policy access
        try {
          assertOrgOwnership(policy, args.orgId, "Policy");
        } catch {
          return "Policy not found.";
        }
        return searchPolicyDocumentWithSourceSpans(ctx, policy, params.query, 8);
      },
    },
    save_note: {
      ...saveNote,
      execute: async (params: { content: string; type: string; policyId?: string }) => {
        const typeMap: Record<string, "fact" | "preference" | "risk_note" | "observation"> = {
          fact: "fact",
          preference: "preference",
          risk_note: "risk_note",
          observation: "observation",
        };
        const memoryType = typeMap[params.type] ?? "observation";
        await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: args.orgId,
          type: memoryType,
          content: params.content,
          source: "chat" as const,
          policyId: params.policyId as Id<"policies"> | undefined,
        });
        return "Note saved to organization memory.";
      },
    },
    generate_coi: {
      ...generateCoi,
      execute: async (input: { policyId: string; certificateHolder?: string }) => {
        // Check org settings — autoGenerateCoi defaults to true if not set
        const autoGenerate = org?.autoGenerateCoi !== false;
        if (!autoGenerate) {
          const handling = org?.coiHandling ?? "ignore";
          if (handling === "broker") {
            return `COI auto-generation is off. Please contact your broker to obtain this certificate.`;
          }
          if (handling === "member") {
            return `COI auto-generation is off. Please route this COI request to your primary insurance contact.`;
          }
          return `COI auto-generation is disabled for this organization.`;
        }
        try {
          const storageId = await ctx.runAction(internal.actions.generateCoi.run, {
            policyId: input.policyId as Id<"policies">,
            orgId: args.orgId,
            certificateHolder: input.certificateHolder,
          });
          if (!storageId) return COI_GENERATION_FAILED_MESSAGE;
          return {
            message: "COI generated and attached to this response.",
            attachment: {
              filename: "certificate-of-insurance.pdf",
              contentType: "application/pdf",
              size: 0,
              fileId: storageId as Id<"_storage">,
            },
          };
        } catch (err) {
          logAiError("processThreadChat.generateCoi", err, {
            threadId: args.threadId,
            orgId: args.orgId,
            policyId: input.policyId,
          });
          return COI_GENERATION_FAILED_MESSAGE;
        }
      },
    },
    create_policy_change_request: {
      ...createPolicyChangeRequest,
      execute: async (input: { requestText: string; policyId?: string; evidenceSourceIds?: string[] }) => {
        try {
          const result = await ctx.runAction(internal.actions.policyChangeRequests.createFromChatForThread, {
            orgId: args.orgId as Id<"organizations">,
            userId: args.userId as Id<"users">,
            policyId: input.policyId as Id<"policies"> | undefined,
            requestText: input.requestText,
            evidenceSourceIds: input.evidenceSourceIds,
          });
          return {
            message: "Policy change request created.",
            caseId: result.caseId,
            usedSdkPce: result.usedSdkPce,
          };
        } catch (err) {
          return `Failed to create policy change request: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

export const run = internalAction({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userMessageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    // Insert processing placeholder
    const agentMsgId = await ctx.runMutation(
      internal.threads.insertAgentMessage,
      { threadId: args.threadId, orgId: args.orgId },
    );

    try {
      // ── Check for cancel/undo intent targeting a pending email ──
      // First check if there are any pending emails in this thread
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId: args.threadId },
      );
      if (pendingEmails.length > 0) {
        const userMsg = await ctx.runQuery(internal.threads.getMessageInternal, {
          id: args.userMessageId,
        });
        // Match cancel words anywhere in short messages (< 100 chars)
        const text = userMsg?.content.trim() ?? "";
        const cancelWords = /\b(cancel|undo|stop|don'?t send|abort|nevermind|never\s*mind|hold on|wait|no\b)/i;
        if (text.length < 100 && cancelWords.test(text)) {
          let cancelledCount = 0;
          for (const pe of pendingEmails) {
            const ok = await ctx.runMutation(
              internal.pendingEmails.cancelInternal,
              { id: pe._id },
            );
            if (ok) cancelledCount++;
          }
          if (cancelledCount > 0) {
            await ctx.runMutation(internal.threads.updateAgentMessage, {
              id: agentMsgId,
              content: cancelledCount === 1
                ? "Done — email cancelled."
                : `Done — ${cancelledCount} pending emails cancelled.`,
            });
            return;
          }
        }
      }

      // Load org
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: args.orgId,
      });
      if (!org) throw new Error("Organization not found");

      // ── Prompt injection guard ──
      const userMsgForGuard = await ctx.runQuery(internal.threads.getMessageInternal, {
        id: args.userMessageId,
      });
      if (userMsgForGuard?.content) {
        const sanitizedContent = enforceInputLimits(userMsgForGuard.content);
        const injectionCheck = await classifyPromptInjection(sanitizedContent);
        if (!injectionCheck.safe) {
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content: "I can't process this request. Please rephrase your question about insurance policies or coverage.",
          });
          console.warn("[security] Prompt injection blocked", {
            threadId: args.threadId,
            reason: injectionCheck.reason,
          });
          return;
        }
      }

      const policies = await ctx.runQuery(
        internal.policies.listAllInternal,
        { orgId: args.orgId },
      );

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl =
        process.env.SITE_URL ?? "https://glass.claritylabs.inc";

      // Build system prompt (reuse direct mode)
      const systemPrompt = buildSystemPromptForContext({
        org,
        mode: "direct",
        userName,
        siteUrl,
      });

      // Load thread messages for history
      const allMessages = await ctx.runQuery(
        internal.threads.messagesInternal,
        { threadId: args.threadId },
      );

      // Find the latest user message for context
      const latestUserMsg = allMessages
        .filter((m: Record<string, unknown>) => m.role === "user")
        .pop();
      const latestUserContent = latestUserMsg?.content ?? "";

      // Build document context (vector search with fallback)
      const { context: docContext, relevantPolicyIds, relevantQuoteIds } = await buildDocumentContext(
        ctx,
        args.orgId,
        policies,
        [],
        latestUserContent,
      );

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(ctx, args.orgId, latestUserContent);

      // Load business intelligence (vector search, deduped against policy context)
      const orgMemoryBlock = await buildIntelligenceContext(
        ctx, args.orgId, latestUserContent,
        relevantPolicyIds.map((id: string) => id),
      );

      // Build message history (skip processing placeholders)
      const messageHistory = buildMessageHistory(allMessages);

      // ── Enrich last user message with file/image attachments ──
      if (latestUserMsg?.attachments?.length) {
        const contentParts: Array<
          | { type: "text"; text: string }
          | { type: "image"; image: string; mediaType: string }
          | { type: "file"; data: string; mediaType: string }
        > = [];
        const attachmentNames: string[] = [];

        for (const att of latestUserMsg.attachments as Array<{
          filename: string;
          contentType: string;
          size: number;
          fileId?: string;
        }>) {
          if (!att.fileId) continue;
          try {
            const blob = await ctx.storage.get(att.fileId);
            if (!blob) continue;
            const buffer = Buffer.from(await blob.arrayBuffer());

            if (att.contentType === "application/pdf") {
              contentParts.push({
                type: "file",
                data: buffer.toString("base64"),
                mediaType: "application/pdf",
              });
              attachmentNames.push(att.filename);
            } else if (att.contentType.startsWith("image/")) {
              contentParts.push({
                type: "image",
                image: buffer.toString("base64"),
                mediaType: att.contentType,
              });
              attachmentNames.push(att.filename);
            } else if (att.contentType.startsWith("text/") || att.contentType === "application/json") {
              contentParts.push({
                type: "text",
                text: `--- Attachment: ${att.filename} ---\n${buffer.toString("utf-8")}\n--- End attachment ---`,
              });
              attachmentNames.push(att.filename);
            }
          } catch (err) {
            console.warn(`Failed to read attachment ${att.filename}:`, err);
          }
        }

        if (contentParts.length > 0) {
          // Replace the last user message with multipart content
          let lastUserIdx = -1;
          for (let i = messageHistory.length - 1; i >= 0; i--) {
            if (messageHistory[i].role === "user") { lastUserIdx = i; break; }
          }
          if (lastUserIdx !== -1) {
            const existingText =
              typeof messageHistory[lastUserIdx].content === "string"
                ? (messageHistory[lastUserIdx].content as string)
                : "";
            contentParts.push({ type: "text", text: existingText });
            messageHistory[lastUserIdx] = {
              role: "user",
              content: contentParts,
            };
          }
        }
      }

      // Detect thread type
      const thread = await ctx.runQuery(internal.threads.getInternal, { id: args.threadId });
      const hasEmailMessages = allMessages.some((m: Record<string, unknown>) => m.channel === "email");
      const isMixedThread = hasEmailMessages || !!thread?.legacyConversationId;
      const emailIdentity = await resolveEmailAgentIdentity(ctx, org);
      const canSendEmail = emailIdentity.canSend;

      // Web chat addendum — adjust email flow based on autoSendEmails setting
      const autoSend = org.autoSendEmails === true; // default false (require confirmation)
      const webChatAddendum = buildChannelInstructions({
        platform: "web",
        isMixedThread,
        canSendEmail,
        autoSendEmails: autoSend,
      });

      // Page context
      let pageContextBlock = "";
      if (thread?.initialContext) {
        const ic = thread.initialContext;
        if (ic.summary) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} detail page:\n- ${ic.summary}\n- Prioritize answering questions about this specific ${ic.pageType}. Reference it directly without the user needing to specify which one.\n`;
        } else if (ic.pageType) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} page.\n`;
        }
      }

      const toolInstructions = buildPolicyToolInstructions(25);

      // Attachment context note
      let attachmentNote = "";
      if (latestUserMsg?.attachments?.length) {
        const filenames = (latestUserMsg.attachments as Array<{ filename: string }>)
          .map((a) => a.filename)
          .join(", ");
        attachmentNote = `\n\nATTACHMENTS: The user's message includes ${latestUserMsg.attachments.length} attachment(s): ${filenames}. The content has been provided to you as file/image content parts. Reference relevant information from attachments in your response when applicable.`;
      }

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        toolInstructions +
        memoryContext +
        orgMemoryBlock +
        attachmentNote;

      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, { orgId: args.orgId });
      const orgMemberEmails = orgMembers.map((m: any) => m?.email).filter(Boolean) as string[];
      const allowedRecipients = collectAllowedRecipients(
        allMessages as Parameters<typeof collectAllowedRecipients>[0],
        orgMemberEmails,
      );
      const availableAttachments = allMessages.flatMap((m: Record<string, unknown>) =>
        ((m.attachments as Array<{
          filename: string;
          contentType: string;
          size: number;
          fileId?: Id<"_storage">;
        }> | undefined) ?? [])
          .filter((att) => att.fileId)
          .map((att) => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size,
            fileId: att.fileId!,
          })),
      );
      const emailToolResult: { current: EmailSubagentResult | null } = { current: null };

      // streamText with tools — supports both streaming Q&A and tool calls
      const tools = {
        ...buildTools(ctx, { orgId: args.orgId, threadId: args.threadId, userId: args.userId }, org),
        ...(emailIdentity.canSend && emailIdentity.agentAddress && emailIdentity.fromHeader
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId: args.orgId,
                threadId: args.threadId,
                chatMessageId: agentMsgId,
                channel: "web",
                fromHeader: `${getEmailAgentFromName(emailIdentity.brokerBranding)} <${thread?.threadEmail ?? emailIdentity.agentAddress}>`,
                agentAddress: thread?.threadEmail ?? emailIdentity.agentAddress,
                brokerBranding: emailIdentity.brokerBranding,
                senderEmail: user?.email,
                defaultCc: user?.email ? [user.email] : undefined,
                subjectHint: thread?.title && thread.title !== "New chat" ? thread.title : undefined,
                allowedRecipients,
                availableAttachments,
                referencedPolicyIds: relevantPolicyIds as Id<"policies">[],
                referencedQuoteIds: relevantQuoteIds as Id<"policies">[],
                autoSendEmails: org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                autoGenerateCoi: org.autoGenerateCoi,
                coiHandling: org.coiHandling,
                conversationContext: allMessages
                  .slice(-12)
                  .map((m: Record<string, unknown>) => `${m.role}: ${m.content}`)
                  .join("\n"),
                onResult: (result) => {
                  emailToolResult.current = result;
                },
              }),
            }
          : {}),
      };
      let content = "";
      let lastFlush = Date.now();
      const FLUSH_INTERVAL = 150;

      // Immediately show "Thinking..." by ensuring processing message is visible
      await ctx.runMutation(internal.threads.streamAgentMessage, {
        id: agentMsgId,
        content: "",
      });

      // Tool call display names for the "thinking" UI
      const TOOL_LABELS: Record<string, string> = {
        lookup_policy: "Searching policies...",
        lookup_policy_section: "Reading policy sections...",
        compare_coverages: "Comparing coverages...",
        send_email: "Drafting email...",
        email_expert: "Preparing email...",
        save_note: "Saving note...",
        generate_coi: "Generating COI...",
        create_policy_change_request: "Creating policy change request...",
      };

      const result = streamText({
        model: await getModelForOrg(ctx, args.orgId, "chat"),
        providerOptions: getProviderOptionsForTask("chat"),
        maxOutputTokens: 4096,
        system: fullSystemPrompt,
        messages: messageHistory,
        tools,
        stopWhen: stepCountIs(25),
      });

      let reasoning = "";
      let hasStartedReasoning = false;
      let lastReasoningFlush = Date.now();
      const citedSections = new Set<string>(); // titles from lookup_policy_section results
      const citedCoverageNames = new Set<string>(); // structured coverage names surfaced by tool results
      const citedSourceSpanIds = new Set<string>(); // stable raw evidence IDs surfaced by tool results
      const citedPolicyIds = new Set<string>(); // policy IDs actually looked up via lookup_policy_section
      const usedTools: string[] = [];
      const toolCalls: Array<{ name: string; input?: string }> = [];
      const responseAttachments: Array<{
        filename: string;
        contentType: string;
        size: number;
        fileId?: Id<"_storage">;
      }> = [];
      let lastToolName = "";
      let lastToolPolicyId = "";

      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") {
          // Stream reasoning separately from content
          reasoning += (part as Record<string, unknown>).text as string ?? (part as Record<string, unknown>).delta as string ?? "";
          if (!hasStartedReasoning) {
            hasStartedReasoning = true;
          }
          // Flush reasoning periodically
          const now = Date.now();
          if (now - lastReasoningFlush >= FLUSH_INTERVAL) {
            lastReasoningFlush = now;
            await ctx.runMutation(internal.threads.streamReasoning, {
              id: agentMsgId,
              reasoning,
            });
          }
        } else if (part.type === "text-delta") {
          content += part.text;
          const now = Date.now();
          if (now - lastFlush >= FLUSH_INTERVAL) {
            lastFlush = now;
            await ctx.runMutation(internal.threads.streamAgentMessage, {
              id: agentMsgId,
              content,
            });
          }
        } else if (part.type === "tool-call") {
          lastToolName = part.toolName;
          const input = ((part as Record<string, unknown>).input as Record<string, unknown> | undefined) ?? undefined;
          lastToolPolicyId = part.toolName === "lookup_policy_section" ? input?.policyId as string ?? "" : "";
          usedTools.push(part.toolName);
          toolCalls.push({
            name: part.toolName,
            input: input ? JSON.stringify(input).slice(0, 500) : undefined,
          });
          const label = TOOL_LABELS[part.toolName] ?? `Using ${part.toolName}...`;
          await ctx.runMutation(internal.threads.streamAgentMessage, {
            id: agentMsgId,
            content: content ? content + `\n\n*${label}*` : `*${label}*`,
          });
        } else if (part.type === "tool-result") {
          if (lastToolName === "generate_coi" && (part as Record<string, unknown>).output) {
            const output = (part as Record<string, unknown>).output;
            if (output && typeof output === "object" && "attachment" in output) {
              const attachment = (output as Record<string, unknown>).attachment;
              if (attachment && typeof attachment === "object") {
                responseAttachments.push(attachment as {
                  filename: string;
                  contentType: string;
                  size: number;
                  fileId?: Id<"_storage">;
                });
              }
            }
          }
          // Capture cited section titles and policy IDs from lookup_policy_section results
          if (lastToolName === "lookup_policy_section" && (part as Record<string, unknown>).output) {
            const output = (part as Record<string, unknown>).output;
            const results = Array.isArray(output) ? output : [output];
            for (const r of results) {
              if (r && typeof r === "object" && r.title) {
                const resultType = (r as Record<string, unknown>).type;
                if (resultType === "coverage") {
                  citedCoverageNames.add(String((r as Record<string, unknown>).title));
                  if (lastToolPolicyId) citedPolicyIds.add(lastToolPolicyId);
                } else {
                  citedSections.add(String((r as Record<string, unknown>).title));
                  if (lastToolPolicyId) citedPolicyIds.add(lastToolPolicyId);
                }
                const sourceSpanIds = (r as Record<string, unknown>).sourceSpanIds;
                if (Array.isArray(sourceSpanIds)) {
                  for (const id of sourceSpanIds) {
                    if (typeof id === "string" && id) citedSourceSpanIds.add(id);
                  }
                }
              }
            }
          }
          // Clear the tool label but keep accumulated content
          await ctx.runMutation(internal.threads.streamAgentMessage, {
            id: agentMsgId,
            content: content || "",
          });
        }
      }

      // Final update — save content, reasoning, and cited sections
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: agentMsgId,
        content,
        referencedPolicyIds: citedPolicyIds.size > 0 ? [...citedPolicyIds] as Id<"policies">[] : undefined,
        referencedQuoteIds: relevantQuoteIds.filter((qid: string) => citedPolicyIds.has(qid)).length > 0
          ? relevantQuoteIds.filter((qid: string) => citedPolicyIds.has(qid)) as Id<"policies">[] : undefined,
        citedSections: citedSections.size > 0 ? [...citedSections] : undefined,
        citedCoverageNames: citedCoverageNames.size > 0 ? [...citedCoverageNames] : undefined,
        citedSourceSpanIds: citedSourceSpanIds.size > 0 ? [...citedSourceSpanIds] : undefined,
        usedTools: usedTools.length > 0 ? usedTools : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        attachments: responseAttachments.length > 0 ? responseAttachments : undefined,
      });
      const emailResult = emailToolResult.current;
      if (emailResult?.status === "pending" && emailResult.pendingEmailId) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content: emailResult.responseBody,
          pendingEmailId: emailResult.pendingEmailId,
          status: "pending_send",
        });
        content = emailResult.responseBody;
      }
      // Save final reasoning if any
      if (reasoning) {
        await ctx.runMutation(internal.threads.streamReasoning, {
          id: agentMsgId,
          reasoning,
        });
      }

      await ctx.runMutation(internal.threads.touchThread, {
        threadId: args.threadId,
      });

      // ── Send email if agent confirmed a send ──
      if (canSendEmail) {
        const sendMatch = content.match(/\*?\*?Sending email to (.+?)\.\.\.\*?\*?\s*\n([\s\S]+)$/i);
        if (sendMatch) {
          try {
            const emailBody = sendMatch[2].trim();
            if (!emailIdentity.agentAddress) throw new Error("No agent handle configured");
            const agentAddress = thread?.threadEmail ?? emailIdentity.agentAddress;

            // Find recipient — prefer the explicit address in the agent's output,
            // fall back to the last inbound email sender
            const recipientHint = sendMatch[1].trim();
            const hintEmailMatch = recipientHint.match(/[\w.+-]+@[\w.-]+\.\w+/);

            const lastInboundEmail = [...allMessages]
              .reverse()
              .find((m) => m.channel === "email" && m.role === "user" && m.fromEmail);

            const replyTo = hintEmailMatch?.[0] ?? lastInboundEmail?.fromEmail;
            if (!replyTo) throw new Error("No email recipient found — include the recipient's email address");

            // Validate recipient against known thread participants and org members
            const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, { orgId: args.orgId });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const orgMemberEmails = orgMembers.map((m: any) => m?.email).filter(Boolean);
            const allowedRecipients = collectAllowedRecipients(allMessages as Parameters<typeof collectAllowedRecipients>[0], orgMemberEmails as string[]);
            const recipientCheck = validateEmailRecipient(replyTo, allowedRecipients);
            if (!recipientCheck.allowed) {
              console.warn("[security] Email recipient blocked", {
                threadId: args.threadId,
                recipient: replyTo,
                reason: recipientCheck.reason,
              });
              throw new Error(recipientCheck.reason!);
            }

            // CC the user who instructed us + any original CCs, excluding the agent
            const replyCc: string[] = [];
            if (user?.email && user.email !== replyTo) {
              replyCc.push(user.email);
            }
            if (lastInboundEmail?.ccAddresses) {
              for (const cc of lastInboundEmail.ccAddresses) {
                if (cc !== agentAddress && cc !== replyTo && !replyCc.includes(cc)) {
                  replyCc.push(cc);
                }
              }
            }

            // Build email subject from thread title
            const threadTitle = thread?.title ?? "New chat";
            const replySubject = threadTitle.startsWith("Re:") ? threadTitle : `Re: ${threadTitle}`;

            // Build email body with signature
            const signature = buildSignature();
            const plainText = stripMarkdown(emailBody) + signature.text;
            const htmlBody = emailBody
              .split("\n\n")
              .map((p: string) => `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`)
              .join("\n") + signature.html;

            // Threading: reference the last email messageId in the thread
            const lastEmailMsg = [...allMessages]
              .reverse()
              .find((m) => m.channel === "email" && (m.messageId || m.responseMessageId));
            const refMessageId = lastEmailMsg?.responseMessageId ?? lastEmailMsg?.messageId;

            const emailPayload: Record<string, unknown> = {
              from: `${getEmailAgentFromName(emailIdentity.brokerBranding)} <${agentAddress}>`,
              to: replyTo,
              subject: replySubject,
              text: plainText,
              html: htmlBody,
            };
            if (replyCc.length > 0) {
              emailPayload.cc = replyCc;
            }
            if (refMessageId) {
              emailPayload.headers = {
                "In-Reply-To": refMessageId,
                "References": refMessageId,
              };
            }

            // Check send delay setting
            const sendDelay = org.emailSendDelay ?? 5; // default 5 seconds

            if (sendDelay > 0) {
              // Queue email with delay
              const scheduledSendTime = Date.now() + sendDelay * 1000;
              const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
                orgId: args.orgId,
                threadId: args.threadId,
                emailPayload: JSON.stringify(emailPayload),
                scheduledSendTime,
                chatMessageId: agentMsgId,
                recipientEmail: replyTo,
                ccAddresses: replyCc.length > 0 ? replyCc : undefined,
                subject: replySubject,
                emailBody,
                referencedPolicyIds: citedPolicyIds.size > 0 ? [...citedPolicyIds] as Id<"policies">[] : undefined,
                referencedQuoteIds: relevantQuoteIds.filter((qid: string) => citedPolicyIds.has(qid)).length > 0
                  ? relevantQuoteIds.filter((qid: string) => citedPolicyIds.has(qid)) as Id<"policies">[] : undefined,
              });

              // Update chat message to show pending state with recipient info
              const ccNote = replyCc.length > 0 ? ` (CC: ${replyCc.join(", ")})` : "";
              await ctx.runMutation(internal.threads.updateAgentMessage, {
                id: agentMsgId,
                content: `Sending email to ${replyTo}${ccNote}...`,
                pendingEmailId,
                status: "pending_send",
              });

              // Schedule the actual send
              await ctx.scheduler.runAfter(
                sendDelay * 1000,
                internal.actions.sendPendingEmail.sendPending,
                { id: pendingEmailId },
              );
            } else {
              // Send immediately (delay = 0)
              const sendOutcome = await sendResendEmail(emailPayload as Parameters<typeof sendResendEmail>[0]);
              if (!sendOutcome.ok) throw new Error(`Failed to send email: ${sendOutcome.error}`);
              const sentMessageId = sendOutcome.id;

              // Insert the sent email as an email-channel message in the thread
              await ctx.runMutation(internal.threads.insertEmailMessage, {
                threadId: args.threadId,
                orgId: args.orgId,
                role: "agent",
                content: emailBody,
                toAddresses: [replyTo],
                ccAddresses: replyCc.length > 0 ? replyCc : undefined,
                subject: replySubject,
                responseMessageId: sentMessageId,
              });

              // Update the chat message to show it was sent
              await ctx.runMutation(internal.threads.updateAgentMessage, {
                id: agentMsgId,
                content: `Email sent to ${replyTo}${replyCc.length > 0 ? ` (CC: ${replyCc.join(", ")})` : ""}.`,
              });
            }
          } catch (err) {
            logAiError("processThreadChat.sendEmail", err, { threadId: args.threadId });
            // Update chat message with error but don't fail the whole action
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(internal.threads.updateAgentMessage, {
              id: agentMsgId,
              content: content + `\n\n_Failed to send email: ${errMsg}_`,
            });
          }
        }
      }

    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logAiError("processThreadChat", error, { threadId: args.threadId, orgId: args.orgId });
      await ctx.runMutation(internal.threads.updateAgentError, {
        id: agentMsgId,
        error: message,
        content: FATAL_ACTION_FAILED_MESSAGE,
      });
    }
  },
});
