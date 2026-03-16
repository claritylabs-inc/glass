export { buildSystemPrompt, buildConversationMemoryContext } from "@claritylabs-inc/cell";
export type { PolicyDocument, QuoteDocument } from "@claritylabs-inc/cell";

// Adapter: map Convex Doc types to cell's framework-agnostic interfaces
import { Doc, Id } from "../_generated/dataModel";
import { buildDocumentContext as _buildDocumentContext, buildPolicyContext as _buildPolicyContext } from "@claritylabs-inc/cell";
import type { PolicyDocument, QuoteDocument } from "@claritylabs-inc/cell";

function toPolicy(p: Doc<"policies">): PolicyDocument {
  return { ...p, id: p._id, type: "policy" };
}

function toQuote(q: Doc<"quotes">): QuoteDocument {
  return { ...q, id: q._id, type: "quote" } as unknown as QuoteDocument;
}

export function buildDocumentContext(
  policies: Doc<"policies">[],
  quotes: Doc<"quotes">[],
  queryText: string,
): { context: string; relevantPolicyIds: Id<"policies">[]; relevantQuoteIds: Id<"quotes">[] } {
  const result = _buildDocumentContext(policies.map(toPolicy), quotes.map(toQuote), queryText);
  return {
    context: result.context,
    relevantPolicyIds: result.relevantPolicyIds as Id<"policies">[],
    relevantQuoteIds: result.relevantQuoteIds as Id<"quotes">[],
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
