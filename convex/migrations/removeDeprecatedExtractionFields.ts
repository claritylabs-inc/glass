/**
 * Migration: remove deprecated extraction status fields from policies, policyFiles,
 * and orgDocuments now that cl-pipelines pipelineFields() is the single source of truth.
 *
 * Fields removed:
 *   policies:     extractionStatus, extractionError, extractionCheckpoint, extractionLog
 *   policyFiles:  extractionStatus, extractionError, extractionLog
 *   orgDocuments: extractionStatus, extractionError
 *
 * Run once against dev and prod after deploying the schema change.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

function stripFields(doc: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

const POLICY_KEYS = ["extractionStatus", "extractionError", "extractionCheckpoint", "extractionLog"];
const POLICY_FILES_KEYS = ["extractionStatus", "extractionError", "extractionLog"];
const ORG_DOCS_KEYS = ["extractionStatus", "extractionError"];

export const removeDeprecatedExtractionFields = internalMutation({
  args: { table: v.union(v.literal("policies"), v.literal("policyFiles"), v.literal("orgDocuments")) },
  handler: async (ctx, args) => {
    const keys = args.table === "policies" ? POLICY_KEYS
      : args.table === "policyFiles" ? POLICY_FILES_KEYS
      : ORG_DOCS_KEYS;

    const docs = await (ctx.db.query(args.table) as any).collect();
    let patched = 0;
    for (const doc of docs) {
      const hasOldField = keys.some((k) => k in doc);
      if (!hasOldField) continue;
      // Build a replacement document without the deprecated fields
      const cleaned = stripFields(doc as Record<string, unknown>, [...keys, "_id", "_creationTime"]);
      await (ctx.db as any).replace(doc._id, cleaned);
      patched++;
    }
    return { table: args.table, patched, total: docs.length };
  },
});
