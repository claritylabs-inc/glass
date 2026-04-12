"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, streamText, stepCountIs } from "ai";
import { getModel, generateTextWithFallback } from "../lib/models";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  checkApplicationStatus,
  saveNote,
  generateCoi,
} from "../lib/chatTools";
import { buildDocumentContext, buildConversationMemoryContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  buildSignature,
  stripMarkdown,
  markdownToHtml,
  logAiError,
} from "../lib/aiUtils";
import { buildMemoryContext } from "../lib/orgMemoryContext";

/** Build executable tools with Convex context wired in. */
function buildTools(ctx: any, args: { orgId: any; threadId: any }, org?: any) {
  return {
    lookup_policy: {
      ...lookupPolicy,
      execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
        const policies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        const q = params.query.toLowerCase();
        const matches = policies.filter((p: any) => {
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
        return matches.slice(0, 5).map((p: any) => ({
          id: p._id,
          insured: p.insuredName,
          carrier: p.security,
          type: p.policyTypes?.join(", "),
          number: p.policyNumber,
          effective: p.effectiveDate,
          expiration: p.expirationDate,
          premium: p.premium,
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
        const p1 = policies.find((p: any) => p._id === params.policyId1);
        const p2 = policies.find((p: any) => p._id === params.policyId2);
        if (!p1 || !p2) return "One or both policies not found.";
        return {
          policy1: { id: p1._id, carrier: p1.security, type: p1.policyTypes, limits: p1.limits, deductibles: p1.deductibles, premium: p1.premium },
          policy2: { id: p2._id, carrier: p2.security, type: p2.policyTypes, limits: p2.limits, deductibles: p2.deductibles, premium: p2.premium },
        };
      },
    },
    lookup_policy_section: {
      ...lookupPolicySection,
      execute: async (params: { policyId: string; query: string }) => {
        const policy = await ctx.runQuery(
          internal.policies.getInternal,
          { id: params.policyId as any },
        );
        if (!policy) return "Policy not found.";
        const doc = policy.document as any;
        if (!doc) return "No document data available for this policy.";

        const q = params.query.toLowerCase();
        const queryWords = q.split(/\s+/).filter((w: string) => w.length > 2);

        function scoreText(text: string): number {
          const lower = text.toLowerCase();
          let score = 0;
          for (const w of queryWords) {
            if (lower.includes(w)) score++;
          }
          if (lower.includes(q)) score += 3;
          return score;
        }

        type ScoredResult = { source: string; title: string; score: number; data: any };
        const results: ScoredResult[] = [];

        // Search sections (with subsections)
        if (doc.sections?.length) {
          for (const s of doc.sections) {
            const subsectionText = (s.subsections ?? [])
              .map((sub: any) => `${sub.title ?? ""} ${sub.content ?? ""}`)
              .join(" ");
            const fullText = `${s.title ?? ""} ${s.content ?? ""} ${subsectionText}`;
            const score = scoreText(fullText);
            if (score > 0) {
              let fullContent = s.content ?? "";
              if (s.subsections?.length) {
                for (const sub of s.subsections) {
                  fullContent += `\n\n### ${sub.title ?? ""}`;
                  if (sub.content) fullContent += `\n${sub.content}`;
                }
              }
              results.push({
                source: "section",
                title: s.title,
                score,
                data: {
                  title: s.title,
                  type: s.type,
                  coverageType: s.coverageType,
                  pages: `${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`,
                  content: fullContent.slice(0, 6000),
                },
              });
            }
          }
        }

        // Search endorsements
        if (doc.endorsements?.length) {
          for (const e of doc.endorsements) {
            const text = `${e.title ?? ""} ${e.content ?? ""} ${e.effectType ?? ""}`;
            const score = scoreText(text);
            if (score > 0) {
              results.push({
                source: "endorsement",
                title: e.title,
                score,
                data: {
                  title: e.title,
                  type: "endorsement",
                  effectType: e.effectType,
                  pages: e.pageStart ? `${e.pageStart}` : undefined,
                  content: (e.content ?? "").slice(0, 6000),
                },
              });
            }
          }
        }

        // Search conditions
        if (doc.conditions?.length) {
          for (const c of doc.conditions) {
            const text = `${c.title ?? ""} ${c.content ?? ""}`;
            const score = scoreText(text);
            if (score > 0) {
              results.push({
                source: "condition",
                title: c.title,
                score,
                data: {
                  title: c.title,
                  type: "condition",
                  pages: c.pageNumber ? `${c.pageNumber}` : undefined,
                  content: (c.content ?? "").slice(0, 4000),
                },
              });
            }
          }
        }

        // Search exclusions
        if (doc.exclusions?.length) {
          for (const ex of doc.exclusions) {
            const text = `${ex.title ?? ""} ${ex.content ?? ""} ${ex.description ?? ""}`;
            const score = scoreText(text);
            if (score > 0) {
              results.push({
                source: "exclusion",
                title: ex.title,
                score,
                data: {
                  title: ex.title,
                  type: "exclusion",
                  content: (ex.content ?? ex.description ?? "").slice(0, 4000),
                },
              });
            }
          }
        }

        // Search declarations (structured data — serialize matching entries)
        if (policy.declarations) {
          const declStr = JSON.stringify(policy.declarations);
          const score = scoreText(declStr);
          if (score > 0) {
            results.push({
              source: "declarations",
              title: "Declarations",
              score,
              data: {
                title: "Declarations",
                type: "declarations",
                content: declStr.slice(0, 6000),
              },
            });
          }
        }

        // Also surface key policy-level fields for coverage analysis
        if (q.includes("coinsurance") || q.includes("valuation") || q.includes("limit")) {
          const policyMeta: Record<string, any> = {};
          if (policy.limits) policyMeta.limits = policy.limits;
          if (policy.deductibles) policyMeta.deductibles = policy.deductibles;
          if (policy.coverageForm) policyMeta.coverageForm = policy.coverageForm;
          if (Object.keys(policyMeta).length > 0) {
            results.push({
              source: "policy_metadata",
              title: "Policy Limits & Structure",
              score: 2,
              data: {
                title: "Policy Limits & Structure",
                type: "metadata",
                content: JSON.stringify(policyMeta, null, 2).slice(0, 4000),
              },
            });
          }
        }

        // Sort by score, return top 5
        results.sort((a, b) => b.score - a.score);
        const top = results.slice(0, 5);

        if (top.length === 0) {
          const sectionTitles = (doc.sections ?? []).map((s: any) => s.title).join(", ");
          const endorsementTitles = (doc.endorsements ?? []).map((e: any) => e.title).join(", ");
          return `No matches for "${params.query}". Available sections: ${sectionTitles || "none"}. Endorsements: ${endorsementTitles || "none"}.`;
        }

        return top.map((r) => r.data);
      },
    },
    check_application_status: {
      ...checkApplicationStatus,
      execute: async (params: { applicationId?: string; query?: string }) => {
        const apps = await ctx.runQuery(
          internal.applicationSessions.listAllInternal,
          { orgId: args.orgId },
        );
        if (params.applicationId) {
          const match = apps.find((a: any) => a._id === params.applicationId);
          return match ?? "Application not found.";
        }
        if (params.query) {
          const q = params.query.toLowerCase();
          const matches = apps.filter((a: any) =>
            a.applicationTitle?.toLowerCase().includes(q) ||
            a.sourceFileName?.toLowerCase().includes(q),
          );
          return matches.length > 0 ? matches : "No matching applications found.";
        }
        return apps.slice(0, 5);
      },
    },
    save_note: {
      ...saveNote,
      execute: async (params: { content: string; type: string; policyId?: string }) => {
        await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: args.orgId,
          type: params.type as any,
          content: params.content,
          source: "chat",
          policyId: params.policyId as any,
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
          if (handling === "broker" && org?.brokerContactName) {
            return `COI auto-generation is off. Please contact your broker, ${org.brokerContactName}${org.brokerContactEmail ? ` (${org.brokerContactEmail})` : ""}, to obtain this certificate.`;
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
              policyId: input.policyId as any,
              orgId: args.orgId,
              certificateHolder: input.certificateHolder,
            },
          );
          return "COI generation started. It will be available for download shortly.";
        } catch (err) {
          return `Failed to generate COI: ${err instanceof Error ? err.message : String(err)}`;
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

      // Load policies, quotes, and applications
      const policies = await ctx.runQuery(
        internal.policies.listAllInternal,
        { orgId: args.orgId },
      );
      const applications = await ctx.runQuery(
        internal.applicationSessions.listAllInternal,
        { orgId: args.orgId },
      );

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl =
        process.env.SITE_URL ?? "https://prism.claritylabs.inc";

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
        .filter((m) => m.role === "user")
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

      // Load org memory
      const orgMemories = await ctx.runQuery(
        internal.orgMemory.listByOrg,
        { orgId: args.orgId, limit: 30 },
      );
      const orgMemoryBlock = buildMemoryContext(orgMemories);

      // Build message history (skip processing placeholders)
      const messageHistory = buildMessageHistory(allMessages);

      // Detect thread type
      const thread = await ctx.runQuery(internal.threads.getInternal, { id: args.threadId });
      const hasEmailMessages = allMessages.some((m) => m.channel === "email");
      const isMixedThread = hasEmailMessages || !!thread?.legacyConversationId;
      // Can send emails from any thread with a threadEmail address
      const canSendEmail = !!thread?.threadEmail;

      // Web chat addendum — adjust email flow based on autoSendEmails setting
      const autoSend = org.autoSendEmails === true; // default false (require confirmation)
      const emailInstructionBlock = autoSend
        ? `- INSTRUCTION: They want you to compose/send a message to the external participant(s).
  - Output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after. Do NOT draft first — send immediately.`
        : `- INSTRUCTION: They want you to compose/send a message to the external participant(s).
  - ALWAYS draft first: show the email labeled as "**Draft email to Name (email@example.com):**" followed by the draft content. Then ask explicitly: "Ready to send?" Do NOT send without drafting first — even if the user says "send" or "email", always show the draft for review first.
  - Only after they explicitly approve the draft (e.g. "yes", "send it", "looks good", "go ahead"): output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after.`;

      const webChatAddendum = isMixedThread
        ? `

MIXED THREAD MODE:
- This thread includes both web chat messages (visible only to the team) and email messages (visible to external participants).
- Use markdown freely -- **bold**, *italic*, headers, bullet points, code blocks are all rendered properly.
- Multiple team members may participate in the same chat. Their name appears in brackets before their message.
- Do NOT include email-style sign-offs or greetings.

When a team member sends a chat message, determine their intent:
- QUESTION: They're asking you something directly — answer normally.
${emailInstructionBlock}
- BOTH: They're asking a question AND giving an instruction — handle both in your response.

For email drafts, compose a professional email that:
- Addresses the recipient by name
- Incorporates the team member's direction naturally
- Maintains appropriate tone for the business relationship
- References relevant policy/coverage data when applicable
- Writes from Prism's perspective (third-person on behalf of the company, e.g. "on behalf of [company]"). Do NOT sign off as the team member or impersonate them. The "sent with Prism" signature is added automatically — do not add your own sign-off.
- If a team member asks you to send the email "from them" or "as them", politely decline and explain that emails are always sent from Prism on behalf of the company.`
        : `

WEB CHAT MODE:
- This is a web chat conversation, not email. Use markdown freely -- **bold**, *italic*, headers, bullet points, code blocks are all rendered properly.
- Keep the conversational style but you can use richer formatting.
- Multiple team members may participate in the same chat. Their name appears in brackets before their message.
- Do NOT include email-style sign-offs or greetings.${canSendEmail ? `

EMAIL SENDING:
You can send emails on behalf of team members. When a team member asks you to send/email something to someone:
${autoSend
  ? `- Output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after.`
  : `- ALWAYS draft first: show the email labeled as "**Draft email to Name (email@example.com):**" followed by the draft content. Then ask explicitly: "Ready to send?" Do NOT send without drafting first — even if the user says "send" or "email", always show the draft for review first.
- Only after they explicitly approve the draft (e.g. "yes", "send it", "looks good", "go ahead"): output ONLY "**Sending email to Name (email@example.com)...**" followed by a newline and then the final email body to send. Always include the recipient's email address in parentheses. Do NOT include any other text before or after.`}

For emails, compose a professional message that:
- Addresses the recipient by name
- Incorporates the team member's direction naturally
- Maintains appropriate tone for the business relationship
- References relevant policy/coverage data when applicable
- Writes from Prism's perspective (third-person on behalf of the company). Do NOT sign off as the team member or impersonate them. The "sent with Prism" signature is added automatically — do not add your own sign-off.` : ""}`;

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

      // Build application context
      let applicationContext = "";
      if (applications.length > 0) {
        const appLines = applications.map((a) => {
          const title = a.applicationTitle ?? a.sourceFileName;
          const progress = a.totalFields
            ? `${a.filledFields ?? 0}/${a.totalFields} fields filled`
            : "";
          return `- ${title} | Status: ${a.status}${progress ? ` | ${progress}` : ""} | ID: ${a._id}`;
        });
        applicationContext = `\n\nAPPLICATION SESSIONS (${applications.length}):\n${appLines.join("\n")}`;
      }

      const toolInstructions = `

TOOLS — POLICY LOOKUP:
You have tools to search and retrieve detailed policy information. You MUST use them aggressively:
- ALWAYS look up the actual policy/endorsement wording before answering coverage questions. NEVER say "I can't confirm without the wording" or "I'd need the endorsement text" — you HAVE the text, use lookup_policy_section to find it.
- When asked about a specific endorsement (e.g. PR650END, PR091END), search for it by form number, title, AND related keywords. Try multiple searches if the first doesn't return what you need.
- When asked about exclusions or conditions, search for the specific exclusion clause (e.g. "B.2" or "Electrical Damage") to get the full text.
- Search for related sections too — e.g. if asked about Equipment Breakdown, also check the base form exclusions that the endorsement might override.
- You have up to 25 tool calls per response. Use as many as needed to give a thorough, wording-backed answer.

ANALYTICAL STANDARDS:
When answering coverage questions, you are an expert insurance analyst, not a disclaimer machine:
- Be assertive about industry practice. If a coverage pattern is standard (e.g. Equipment Breakdown endorsements are designed to override base form electrical damage exclusions), say so clearly rather than treating it as unknowable.
- ALWAYS check for coinsurance provisions. Coinsurance penalties are one of the most common and impactful coverage traps. If BPP or building coverage has 80%/90%/100% coinsurance, flag the potential penalty and explain how it applies.
- Flag coverage adequacy issues proactively. If a sublimit seems low for the insured's business type (e.g. $25,000 spoilage for a full-service restaurant), call it out as a potential gap worth reviewing.
- When analyzing overlapping coverages, explain the hierarchy clearly: which coverage responds first, whether limits stack or erode each other, and how deductibles interact.
- Distinguish between what the policy text says vs. what would require carrier confirmation. Some things genuinely need the carrier (e.g. ambiguous manuscripted endorsements), but standard ISO/AAIS forms have well-understood interpretations.
- When a coverage question involves the physical cause of loss, analyze the causal chain: where did the loss originate, what's the proximate cause, and how does that interact with each relevant coverage grant and exclusion.`;

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        toolInstructions +
        applicationContext +
        memoryContext +
        orgMemoryBlock;

      // streamText with tools — supports both streaming Q&A and tool calls
      const tools = buildTools(ctx, { orgId: args.orgId, threadId: args.threadId }, org);
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
        check_application_status: "Checking application...",
        send_email: "Drafting email...",
        save_note: "Saving note...",
        generate_coi: "Generating COI...",
      };

      const result = streamText({
        model: getModel("chat"),
        maxOutputTokens: 4096,
        system: fullSystemPrompt,
        messages: messageHistory,
        tools,
        stopWhen: stepCountIs(25),
      });

      let reasoning = "";
      let hasStartedReasoning = false;
      let lastReasoningFlush = Date.now();

      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") {
          // Stream reasoning separately from content
          reasoning += (part as any).text ?? (part as any).delta ?? "";
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
          // Preserve any pre-tool text — the model may produce partial responses
          // between tool calls, and clearing would lose the final answer if
          // the model hits the step limit during tool use.
          const label = TOOL_LABELS[part.toolName] ?? `Using ${part.toolName}...`;
          await ctx.runMutation(internal.threads.streamAgentMessage, {
            id: agentMsgId,
            content: content ? content + `\n\n*${label}*` : `*${label}*`,
          });
        } else if (part.type === "tool-result") {
          // Clear the tool label but keep accumulated content
          await ctx.runMutation(internal.threads.streamAgentMessage, {
            id: agentMsgId,
            content: content || "",
          });
        }
      }

      // Final update — save both content and reasoning
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: agentMsgId,
        content,
        referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
        referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
      });
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
            const agentHandle = org.agentHandle;
            if (!agentHandle) throw new Error("No agent handle configured");

            const agentDomain = process.env.AGENT_DOMAIN ?? "dev.claritylabs.inc";
            const agentAddress = thread?.threadEmail ?? `${agentHandle}@${agentDomain}`;

            // Find recipient — prefer the explicit address in the agent's output,
            // fall back to the last inbound email sender
            const recipientHint = sendMatch[1].trim();
            const hintEmailMatch = recipientHint.match(/[\w.+-]+@[\w.-]+\.\w+/);

            const lastInboundEmail = [...allMessages]
              .reverse()
              .find((m) => m.channel === "email" && m.role === "user" && m.fromEmail);

            const replyTo = hintEmailMatch?.[0] ?? lastInboundEmail?.fromEmail;
            if (!replyTo) throw new Error("No email recipient found — include the recipient's email address");

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
              from: `Prism <${agentAddress}>`,
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
                referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
                referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
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
              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(emailPayload),
              });

              const resBody = await res.text();
              if (!res.ok) throw new Error(`Failed to send email: ${resBody}`);

              let sentMessageId: string | undefined;
              try { sentMessageId = JSON.parse(resBody).id; } catch {}

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

      // Auto-title: if this is the first user message, generate a title
      const userMessages = allMessages.filter((m) => m.role === "user");
      if (userMessages.length === 1) {
        try {
          const { text: titleText } = await generateText({
            model: getModel("summary"),
            maxOutputTokens: 12,
            system:
              "You are a title generator. Given a user question and an assistant reply, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
            messages: [
              {
                role: "user",
                content: `User: ${userMessages[0].content}\n\nAssistant: ${content.slice(0, 200)}`,
              },
            ],
          });
          const title = titleText
            .trim()
            .replace(/^["']|["']$/g, "")
            .split("\n")[0]; // take only first line
          if (title && title.length <= 40) {
            await ctx.runMutation(internal.threads.updateTitleInternal, {
              threadId: args.threadId,
              title,
            });
          }
        } catch {
          // Non-critical — title stays as "New chat"
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logAiError("processThreadChat", error, { threadId: args.threadId, orgId: args.orgId });
      await ctx.runMutation(internal.threads.updateAgentError, {
        id: agentMsgId,
        error: message,
      });
    }
  },
});
