export { buildSystemPrompt, buildConversationMemoryContext } from "@claritylabs/cl-sdk";
export type { PolicyDocument, QuoteDocument } from "@claritylabs/cl-sdk";

// Adapter: map Convex Doc types to cell's framework-agnostic interfaces
import { Doc, Id } from "../_generated/dataModel";
import { buildDocumentContext as _buildDocumentContext, buildPolicyContext as _buildPolicyContext } from "@claritylabs/cl-sdk";
import type { PolicyDocument, QuoteDocument } from "@claritylabs/cl-sdk";

function toPolicy(p: Doc<"policies">): PolicyDocument {
  return { ...p, id: p._id, type: "policy" } as unknown as PolicyDocument;
}

function toQuote(q: Doc<"policies">): QuoteDocument {
  return { ...q, id: q._id, type: "quote" } as unknown as QuoteDocument;
}

export function buildDocumentContext(
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): { context: string; relevantPolicyIds: Id<"policies">[]; relevantQuoteIds: Id<"policies">[] } {
  const result = _buildDocumentContext(policies.map(toPolicy), quotes.map(toQuote), queryText);
  return {
    context: result.context,
    relevantPolicyIds: result.relevantPolicyIds as Id<"policies">[],
    relevantQuoteIds: result.relevantQuoteIds as Id<"policies">[],
  };
}

/** @deprecated Use buildDocumentContext instead */
export function buildPolicyContext(
  policies: Doc<"policies">[],
  queryText: string,
): { context: string; relevantPolicyIds: Id<"policies">[] } {
  const result = _buildDocumentContext(policies.map(toPolicy), [], queryText);
  return {
    context: result.context,
    relevantPolicyIds: result.relevantPolicyIds as Id<"policies">[],
  };
}
