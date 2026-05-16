"use node";

import { createHash, createHmac } from "crypto";
import dayjs from "dayjs";

export type DoclingParseResult = {
  markdown: string;
  docTagsJson?: unknown;
  parserVersion?: string;
  parsingMs?: number;
};

export type DoclingParserAudit = {
  parserBackend: "docling";
  parserVersion?: string;
  parsedMarkdown: string;
  docTagsJson?: unknown;
  parsingMs?: number;
};

export async function parsePdf({
  pdfBytes,
  mimeType = "application/pdf",
}: {
  pdfBytes: Uint8Array;
  mimeType?: string;
}): Promise<DoclingParseResult> {
  const url = process.env.DOCLING_URL;
  const secret = process.env.DOCLING_HMAC_SECRET;
  if (!url || !secret) {
    throw new Error("Docling is enabled but DOCLING_URL or DOCLING_HMAC_SECRET is not configured");
  }

  const body = Buffer.from(pdfBytes);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const timestamp = Math.floor(dayjs().valueOf() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${bodyHash}`)
    .digest("hex");

  const endpoint = new URL("/v1/parse", url).toString();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "X-Docling-Timestamp": timestamp,
          "X-Docling-Signature": signature,
        },
        body,
      });

      if (response.status >= 500 && attempt === 0) {
        lastError = new Error(`Docling parse failed with ${response.status}: ${await response.text()}`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Docling parse failed with ${response.status}: ${await response.text()}`);
      }

      const json = await response.json() as Partial<DoclingParseResult>;
      if (typeof json.markdown !== "string" || json.markdown.length === 0) {
        throw new Error("Docling parse response did not include markdown");
      }
      return {
        markdown: json.markdown,
        docTagsJson: json.docTagsJson,
        parserVersion: typeof json.parserVersion === "string" ? json.parserVersion : undefined,
        parsingMs: typeof json.parsingMs === "number" ? json.parsingMs : undefined,
      };
    } catch (error) {
      lastError = error;
      if (attempt > 0) break;
      if (error instanceof Error && !error.message.includes("fetch")) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
