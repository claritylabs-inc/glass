"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

function applyExtracted(extracted: any) {
  const policyTypes = Array.isArray(extracted.policyTypes)
    ? extracted.policyTypes
    : extracted.policyType
      ? [extracted.policyType]
      : ["other"];

  return {
    carrier: extracted.carrier || "Unknown",
    mga: extracted.mga || undefined,
    broker: extracted.broker || undefined,
    policyNumber: extracted.policyNumber || "Unknown",
    policyTypes,
    documentType: (extracted.documentType === "quote" ? "quote" : "policy") as "policy" | "quote",
    policyYear: extracted.policyYear || new Date().getFullYear(),
    effectiveDate: extracted.effectiveDate || "Unknown",
    expirationDate: extracted.expirationDate || "Unknown",
    isRenewal: extracted.isRenewal ?? false,
    coverages: extracted.coverages || [],
    premium: extracted.premium,
    insuredName: extracted.insuredName || "Unknown",
    summary: extracted.summary,
    extractionStatus: "complete" as const,
    extractionError: "",
  };
}

export const retryExtraction = action({
  args: {
    policyId: v.id("policies"),
    mode: v.optional(v.union(v.literal("reparse"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };
    if (!policy.emailId) return { error: "No linked email — cannot retry" };

    const mode = args.mode ?? "auto";

    // Reparse mode: only re-parse the saved raw response
    if (mode === "reparse" || mode === "auto") {
      if (policy.rawExtractionResponse) {
        try {
          const responseText = stripFences(policy.rawExtractionResponse);
          const extracted = JSON.parse(responseText);

          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            fileName: `${extracted.policyNumber || "policy"}.pdf`,
            ...applyExtracted(extracted),
          });

          return { success: true, reused: true };
        } catch {
          if (mode === "reparse") {
            return { error: "Could not parse saved AI response" };
          }
          // auto mode: fall through to full retry
        }
      } else if (mode === "reparse") {
        return { error: "No saved AI response to re-parse" };
      }
    }

    // Full retry with API call
    const emails = await ctx.runQuery(api.emails.list, {});
    const email = emails.find((e: any) => e._id === policy.emailId);
    if (!email) return { error: "Linked email not found" };

    const connection = await ctx.runQuery(api.connections.get, {
      id: email.connectionId,
    });
    if (!connection) return { error: "Email connection not found" };

    // Reset status to extracting
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      // Download PDF attachment via IMAP
      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: true,
        auth: { user: connection.email, pass: connection.password },
        logger: false,
      });

      let pdfBuffer: Buffer;
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const { content } = await client.download(
            String(email.uid ?? 0),
            "2",
            { uid: true }
          );
          const chunks: Buffer[] = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
          }
          pdfBuffer = Buffer.concat(chunks);
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (error) {
        try {
          await client.logout();
        } catch {
          /* ignore */
        }
        throw error;
      }

      // Store in Convex file storage
      const blob = new Blob([new Uint8Array(pdfBuffer)], {
        type: "application/pdf",
      });
      const fileId = await ctx.storage.store(blob);

      // Send PDF to Claude for extraction
      const pdfBase64 = pdfBuffer.toString("base64");
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: `Extract structured metadata from this insurance document. Respond with JSON only:
{
  "carrier": "insurance carrier / underwriter name",
  "mga": "MGA or MGU name if different from carrier, or null",
  "broker": "insurance broker name, or null",
  "policyNumber": "policy number",
  "documentType": "policy" or "quote",
  "policyTypes": ["general_liability", "workers_comp", "commercial_auto", "non_owned_auto", "property", "umbrella", "professional_liability", "cyber", "epli", "directors_officers", "other"],
  "policyYear": number,
  "effectiveDate": "MM/DD/YYYY",
  "expirationDate": "MM/DD/YYYY",
  "isRenewal": boolean,
  "coverages": [{"name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX"}],
  "premium": "$X,XXX",
  "insuredName": "name of insured party",
  "summary": "1-2 sentence summary"
}
policyTypes should include ALL coverage types found in the document. documentType should be "quote" if this is a quote/proposal, "policy" if it is a bound policy.`,
              },
            ],
          },
        ],
      });

      const rawText =
        response.content[0].type === "text" ? response.content[0].text : "{}";

      // Save raw response for future retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: rawText,
      });

      const responseText = stripFences(rawText);
      const extracted = JSON.parse(responseText);

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        fileId,
        fileName: `${extracted.policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      return { success: true };
    } catch (error: any) {
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      return { error: error.message || "Extraction failed" };
    }
  },
});
