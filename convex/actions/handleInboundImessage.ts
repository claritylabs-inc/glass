"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { getModelForOrg } from "../lib/models";
import { haikuModel } from "../lib/ai";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  saveNote,
  generateCoi as generateCoiTool,
} from "../lib/chatTools";
import {
  buildDocumentContext,
  buildConversationMemoryContext,
  buildIntelligenceContext,
} from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  policySearchScore,
} from "../lib/aiUtils";
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";
import type { Id } from "../_generated/dataModel";

/** Normalize a raw phone string to E.164 (+1XXXXXXXXXX). */
function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function buildInboundEventKey(args: {
  fromPhone: string;
  messageText: string;
  sourceMessageId?: string;
  receivedAt?: number;
  attachments?: Array<{ mimeType: string; name: string; data: string }>;
}): string {
  const hash = createHash("sha256");
  if (args.sourceMessageId) {
    hash.update(`source:${args.fromPhone}:${args.sourceMessageId}`);
  } else {
    const minuteBucket = Math.floor((args.receivedAt ?? Date.now()) / 60000);
    hash.update(`fallback:${args.fromPhone}:${minuteBucket}:${args.messageText}`);
    for (const attachment of args.attachments ?? []) {
      hash.update(`:${attachment.name}:${attachment.mimeType}:${attachment.data.length}`);
    }
  }
  return hash.digest("hex");
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

/** Response shape returned to the HTTP route (and hence to the worker). */
type ImessageResponse = {
  response: string;
  attachments?: Array<{ url: string; filename: string; mimeType: string }>;
};

function cleanJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

async function sendImmediateImessage(params: {
  toPhone: string;
  message: string;
}): Promise<boolean> {
  const workerUrl = process.env.IMESSAGE_WORKER_URL;
  if (!workerUrl) return false;

  try {
    const res = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
      },
      body: JSON.stringify({
        toPhone: params.toPhone,
        message: params.message,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[imessage] Status cue send failed ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[imessage] Status cue send failed:", err);
    return false;
  }
}

async function generateImessageStatusCue(params: {
  messageText: string;
  hasAttachments: boolean;
  userName?: string;
}): Promise<string | null> {
  try {
    const result = await generateText({
      model: haikuModel,
      maxOutputTokens: 120,
      system: `You decide whether an insurance SMS assistant should send a quick status cue before doing retrieval or tool work.
Return strict JSON only: {"send": boolean, "message": string | null}.

Send only when the user's latest text is a substantive insurance question, document/attachment request, COI request, comparison, lookup, or task likely to require checking policy data/tools.
Do not send for greetings, thanks, acknowledgements, corrections, jokes, spam, or messages that can be answered immediately without checking anything.

If sending, write one warm, natural SMS sentence under 70 characters. It should say you're checking or taking a look, without promising a result.
No markdown, no emoji, no greeting, no sign-off.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            userName: params.userName ?? null,
            messageText: params.messageText,
            hasAttachments: params.hasAttachments,
          }),
        },
      ],
    });

    const parsed = JSON.parse(cleanJsonText(result.text)) as {
      send?: unknown;
      message?: unknown;
    };
    if (parsed.send !== true || typeof parsed.message !== "string") return null;
    const message = parsed.message.trim().replace(/\s+/g, " ");
    if (message.length === 0 || message.length > 90) return null;
    return message;
  } catch (err) {
    console.warn("[imessage] Status cue generation failed:", err);
    return null;
  }
}

export const processInbound = internalAction({
  args: {
    fromPhone: v.string(),
    messageText: v.string(),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          data: v.string(),    // base64-encoded bytes
          mimeType: v.string(),
          name: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, args): Promise<ImessageResponse> => {
    const fromPhone = normalizePhone(args.fromPhone);
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";
    const eventKey = buildInboundEventKey({
      fromPhone,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      attachments: args.attachments,
    });

    const claim = await ctx.runMutation(internal.imessageInboundEvents.claim, {
      eventKey,
      fromPhone,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
    });
    if (claim.duplicate) {
      console.log("[imessage] Duplicate inbound event ignored", {
        fromPhone,
        sourceMessageId: args.sourceMessageId,
        status: claim.status,
      });
      return { response: "" };
    }

    const finish = async (response: string, attachments?: ImessageResponse["attachments"]) => {
      await ctx.runMutation(internal.imessageInboundEvents.complete, {
        eventKey,
        response,
      });
      return { response, attachments };
    };

    // ── 1. Resolve user by phone ──────────────────────────────────────────
    const user = await ctx.runQuery(internal.users.findByPhone, { phone: fromPhone });
    if (!user) {
      return await finish(`Sign up to use Glass: ${siteUrl}/signup/client`);
    }

    // ── 2. Resolve org ────────────────────────────────────────────────────
    const membership = await ctx.runQuery(internal.orgs.getUserMembership, {
      userId: user._id,
    });
    if (!membership) {
      return await finish(`Sign up to use Glass: ${siteUrl}/signup/client`);
    }
    const orgId = membership.orgId;

    // ── 3. Prompt injection guard ─────────────────────────────────────────
    const guardedText = enforceInputLimits(args.messageText);
    const injectionCheck = await classifyPromptInjection(guardedText);
    if (!injectionCheck.safe) {
      console.warn("[security] iMessage prompt injection blocked", { fromPhone });
      return await finish("I can't process that request.");
    }

    // ── 4. Thread routing ─────────────────────────────────────────────────
    const threadId = await ctx.runMutation(internal.threads.findOrCreateByPhone, {
      orgId,
      userId: user._id,
      fromPhone,
      userName: user.name,
    });

    // ── 5. Fetch org context ──────────────────────────────────────────────
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
    if (!org) return await finish("Unable to find your account.");

    const userName = user.name?.split(/\s+/)[0];

    // Send a model-decided status cue before heavier retrieval/tool work so SMS
    // users get immediate feedback when the agent needs to check policy data.
    const statusCue = await generateImessageStatusCue({
      messageText: args.messageText,
      hasAttachments: (args.attachments?.length ?? 0) > 0,
      userName,
    });
    if (statusCue) {
      const sent = await sendImmediateImessage({
        toPhone: fromPhone,
        message: statusCue,
      });
      if (sent) {
        await ctx.runMutation(internal.threads.insertImessageMessage, {
          threadId,
          orgId,
          role: "agent",
          content: statusCue,
          responseMessageId: `${eventKey}:status`,
        });
      }
    }

    // ── 6. Store attachments in Convex file storage ───────────────────────
    type AttachmentRecord = {
      filename: string;
      contentType: string;
      size: number;
      fileId?: Id<"_storage">;
      buffer?: Buffer;
    };
    const attachmentRecords: AttachmentRecord[] = [];
    for (const att of args.attachments ?? []) {
      if (!SUPPORTED_MIME_TYPES.has(att.mimeType)) continue;
      try {
        const buffer = Buffer.from(att.data, "base64");
        const blob = new Blob([new Uint8Array(buffer)], { type: att.mimeType });
        const fileId = await ctx.storage.store(blob);
        attachmentRecords.push({
          filename: att.name,
          contentType: att.mimeType,
          size: buffer.byteLength,
          fileId,
          buffer,
        });
      } catch (err) {
        console.warn(`[imessage] Failed to store attachment ${att.name}:`, err);
      }
    }

    // ── 7. Persist inbound user message ──────────────────────────────────
    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId,
      orgId,
      role: "user",
      userId: user._id,
      userName: user.name,
      content: args.messageText,
      messageId: args.sourceMessageId ?? eventKey,
      attachments:
        attachmentRecords.length > 0
          ? attachmentRecords.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
              fileId: a.fileId,
            }))
          : undefined,
    });

    // ── 8. Build retrieval context ────────────────────────────────────────
    const policies = await ctx.runQuery(internal.policies.listAllInternal, { orgId });
    const { context: policyContext, relevantPolicyIds } = await buildDocumentContext(
      ctx,
      orgId,
      policies,
      [],
      args.messageText,
    );
    const memoryContext = await buildConversationMemoryContext(ctx, orgId, args.messageText);
    const orgMemoryBlock = await buildIntelligenceContext(
      ctx,
      orgId,
      args.messageText,
      relevantPolicyIds.map(String),
    );

    // ── 9. Build message history from thread ──────────────────────────────
    const history = await ctx.runQuery(internal.threads.getImessageHistory, {
      threadId,
      limit: 16,
    });
    const modelMessages: ModelMessage[] = [];
    for (const msg of history) {
      if (msg.status === "processing") continue;
      // Skip the message we just inserted (the inbound one)
      if (msg.role === "user" && msg.content === args.messageText) continue;
      // Status cues are sent for responsiveness and should not steer the final answer.
      if (msg.role === "agent" && msg.responseMessageId === `${eventKey}:status`) continue;
      if (msg.role === "user") {
        modelMessages.push({ role: "user", content: msg.userName ? `[${msg.userName}]: ${msg.content}` : msg.content });
      } else if (msg.role === "agent" && msg.content) {
        modelMessages.push({ role: "assistant", content: msg.content });
      }
    }
    // Append current message
    modelMessages.push({ role: "user", content: args.messageText });

    // ── 10. Attach PDF/image content for model context ────────────────────
    if (attachmentRecords.length > 0) {
      const lastMsg = modelMessages[modelMessages.length - 1];
      if (lastMsg.role === "user" && typeof lastMsg.content === "string") {
        type ContentPart =
          | { type: "text"; text: string }
          | { type: "file"; data: string; mediaType: string }
          | { type: "image"; image: string; mediaType: string };
        const parts: ContentPart[] = [];
        for (const att of attachmentRecords) {
          if (!att.buffer) continue;
          if (att.contentType === "application/pdf") {
            parts.push({ type: "file", data: att.buffer.toString("base64"), mediaType: "application/pdf" });
          } else if (att.contentType.startsWith("image/")) {
            parts.push({ type: "image", image: att.buffer.toString("base64"), mediaType: att.contentType });
          }
        }
        if (parts.length > 0) {
          parts.push({ type: "text", text: lastMsg.content });
          modelMessages[modelMessages.length - 1] = { role: "user", content: parts };
        }
      }
    }

    // ── 11. Build system prompt ───────────────────────────────────────────
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

    const systemPrompt =
      buildSystemPromptForContext({
        org: {
          name: org.name,
          context: org.context,
          coiHandling: org.coiHandling,
          broker: brokerName
            ? { name: brokerName, contactName: brokerContactName, contactEmail: brokerContactEmail }
            : undefined,
        },
        mode: "direct",
        userName,
        siteUrl,
      }) +
      buildChannelInstructions({ platform: "imessage" }) +
      "\n\n" +
      policyContext +
      buildPolicyToolInstructions(8) +
      memoryContext +
      orgMemoryBlock;

    // ── 12. Wire up tools ─────────────────────────────────────────────────
    const coiAttachments: Array<{ storageId: Id<"_storage">; filename: string }> = [];

    const imessageTools = {
      lookup_policy: {
        ...lookupPolicy,
        execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
          const scored = (policies as any[])
            .map((p) => ({
              policy: p,
              score: policySearchScore(p, params.query, params.policyType, params.carrier),
            }))
            .filter((p) => p.score > 0)
            .sort((a, b) => b.score - a.score);
          const matches = scored.length > 0
            ? scored.map((s) => s.policy)
            : (policies as any[]).slice(0, 5);
          if (matches.length === 0) return "No policies found.";
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
              name: c.name, limit: c.limit, deductible: c.deductible,
            })),
          }));
        },
      },
      lookup_policy_section: {
        ...lookupPolicySection,
        execute: async (params: { policyId: string; query: string }) => {
          const policy: any = await ctx.runQuery(internal.policies.getInternal, {
            id: params.policyId as Id<"policies">,
          });
          if (!policy || policy.orgId !== orgId) return "Policy not found.";
          const doc = policy.document;
          if (!doc) return "No document data available.";
          const q = params.query.toLowerCase();
          const results: Array<{ title: string; type: string; content: string }> = [];
          for (const s of (doc.sections ?? []) as any[]) {
            const text = `${s.title ?? ""} ${s.content ?? ""}`.toLowerCase();
            if (text.includes(q)) {
              results.push({ title: s.title, type: "section", content: String(s.content ?? "").slice(0, 4000) });
            }
          }
          for (const e of (doc.endorsements ?? []) as any[]) {
            const text = `${e.title ?? ""} ${e.content ?? ""}`.toLowerCase();
            if (text.includes(q)) {
              results.push({ title: e.title, type: "endorsement", content: String(e.content ?? "").slice(0, 4000) });
            }
          }
          return results.slice(0, 5);
        },
      },
      compare_coverages: {
        ...compareCoverages,
        execute: async (params: { policyId1: string; policyId2: string }) => {
          const p1 = (policies as any[]).find((p) => p._id === params.policyId1);
          const p2 = (policies as any[]).find((p) => p._id === params.policyId2);
          if (!p1 || !p2) return "One or both policies not found.";
          const mapP = (p: any) => ({
            id: p._id, carrier: p.security, type: p.policyTypes, limits: p.limits,
            coverages: (p.coverages ?? []).map((c: any) => ({ name: c.name, limit: c.limit })),
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
            source: "imessage" as const,
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
            if (handling === "broker") return "COI auto-generation is off. Contact your broker.";
            if (handling === "member") return "COI auto-generation is off. Contact your insurance contact.";
            return "COI auto-generation is disabled for this organization.";
          }
          try {
            // Run COI generation inline so we can attach the PDF to the iMessage reply
            const storageId = await ctx.runAction(internal.actions.generateCoi.run, {
              policyId: params.policyId as Id<"policies">,
              orgId,
              certificateHolder: params.certificateHolder,
            });
            if (!storageId) return "Failed to generate COI.";
            coiAttachments.push({
              storageId: storageId as Id<"_storage">,
              filename: "certificate-of-insurance.pdf",
            });
            return "COI generated and will be sent as an attachment.";
          } catch (err) {
            return `Failed to generate COI: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
    };

    // ── 13. Run model ─────────────────────────────────────────────────────
    const result = await generateText({
      model: await getModelForOrg(ctx, orgId, "chat"),
      // iMessage responses should be short — cap at 512 tokens
      maxOutputTokens: 512,
      system: systemPrompt,
      messages: modelMessages,
      tools: imessageTools,
      stopWhen: stepCountIs(8),
    });

    const responseText = result.text;

    // ── 14. Resolve COI attachment URLs ───────────────────────────────────
    const responseAttachments: Array<{ url: string; filename: string; mimeType: string }> = [];
    for (const coi of coiAttachments) {
      try {
        const url = await ctx.storage.getUrl(coi.storageId);
        if (url) {
          responseAttachments.push({ url, filename: coi.filename, mimeType: "application/pdf" });
        }
      } catch (err) {
        console.warn("[imessage] Failed to get COI URL:", err);
      }
    }

    // ── 15. Persist agent response ────────────────────────────────────────
    const agentAttachments = coiAttachments.map((c) => ({
      filename: c.filename,
      contentType: "application/pdf",
      size: 0,
      fileId: c.storageId,
    }));
    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId,
      orgId,
      role: "agent",
      content: responseText,
      responseMessageId: `${eventKey}:response`,
      referencedPolicyIds:
        relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
      attachments: agentAttachments.length > 0 ? agentAttachments : undefined,
    });

    // ── 16. Post-exchange orgMemory extraction ────────────────────────────
    try {
      const memoryExtraction = await generateText({
        model: haikuModel,
        maxOutputTokens: 400,
        system: `Extract durable facts, preferences, risk notes, or observations about an organization from a short text exchange.
Output a strict JSON array of up to 3 items: [{"type": "fact"|"preference"|"risk_note"|"observation", "content": string}].
Only include items worth remembering long-term. Skip pleasantries and one-off questions. Output ONLY the JSON array.`,
        messages: [
          {
            role: "user",
            content: `USER: ${args.messageText}\n\nAGENT: ${responseText}`,
          },
        ],
      });
      let parsed: Array<{ type: string; content: string }> = [];
      try {
        const cleaned = cleanJsonText(memoryExtraction.text);
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) parsed = arr;
      } catch {
        // ignore parse failures
      }
      const allowedTypes = new Set(["fact", "preference", "risk_note", "observation"]);
      const items = parsed
        .filter((it) => it && typeof it.content === "string" && allowedTypes.has(it.type))
        .slice(0, 3)
        .map((it) => ({
          orgId,
          type: it.type as "fact" | "preference" | "risk_note" | "observation",
          content: it.content.trim(),
          source: "imessage" as const,
        }))
        .filter((it) => it.content.length > 0);
      if (items.length > 0) {
        await ctx.runMutation(internal.orgMemory.bulkInsert, { items });
      }
    } catch (err) {
      console.warn("[imessage] orgMemory extraction failed:", err);
    }

    return await finish(
      responseText,
      responseAttachments.length > 0 ? responseAttachments : undefined,
    );
  },
});
