"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api } from "../_generated/api";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";

export const extractPolicy = internalAction({
  args: {
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
  },
  handler: async (ctx, args) => {
    const emails = await ctx.runQuery(api.emails.list, {
      connectionId: args.connectionId,
    });
    const thisEmail = emails.find((e) => e._id === args.emailId);
    if (!thisEmail) throw new Error("Email not found");

    const connection = await ctx.runQuery(api.connections.get, {
      id: args.connectionId,
    });
    if (!connection) throw new Error("Connection not found");

    // Create a pending policy record
    const policyId = await ctx.runMutation(api.policies.insert, {
      emailId: args.emailId,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyType: "other",
      policyYear: new Date().getFullYear(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
      extractionStatus: "extracting",
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
            String(thisEmail.uid ?? 0),
            "2", // Common part ID for first attachment
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

      // Send PDF directly to Claude as base64 (Claude supports native PDF input)
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
                text: `Extract structured metadata from this insurance policy document. Respond with JSON only:
{
  "carrier": "insurance company name",
  "policyNumber": "policy number",
  "policyType": one of ["general_liability", "workers_comp", "commercial_auto", "property", "umbrella", "professional_liability", "cyber", "epli", "directors_officers", "other"],
  "policyYear": number,
  "effectiveDate": "MM/DD/YYYY",
  "expirationDate": "MM/DD/YYYY",
  "isRenewal": boolean,
  "coverages": [{"name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX"}],
  "premium": "$X,XXX",
  "insuredName": "name of insured party",
  "summary": "1-2 sentence summary"
}`,
              },
            ],
          },
        ],
      });

      const rawText =
        response.content[0].type === "text" ? response.content[0].text : "{}";

      // Save raw response so retries can re-parse without calling the API
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        rawExtractionResponse: rawText,
      });

      const responseText = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      const extracted = JSON.parse(responseText);

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileId,
        fileName: `${extracted.policyNumber || "policy"}.pdf`,
        carrier: extracted.carrier || "Unknown",
        policyNumber: extracted.policyNumber || "Unknown",
        policyType: extracted.policyType || "other",
        policyYear: extracted.policyYear || new Date().getFullYear(),
        effectiveDate: extracted.effectiveDate || "Unknown",
        expirationDate: extracted.expirationDate || "Unknown",
        isRenewal: extracted.isRenewal ?? false,
        coverages: extracted.coverages || [],
        premium: extracted.premium,
        insuredName: extracted.insuredName || "Unknown",
        summary: extracted.summary,
        extractionStatus: "complete",
      });
    } catch (error: any) {
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      console.error("Policy extraction failed:", error.message);
    }
  },
});
