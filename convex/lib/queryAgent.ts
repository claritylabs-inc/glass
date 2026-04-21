"use node";

/**
 * Query agent — cl-sdk
 *
 * Wraps createQueryAgent with Glass's model routing and Convex storage.
 * Provides citation-backed Q&A over policy/quote documents.
 */

import { createQueryAgent } from "@claritylabs/cl-sdk";
import type { QueryInput, QueryOutput } from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { makeGenerateText, makeGenerateObject, makeEmbedText } from "./sdkCallbacks";
import { createConvexDocumentStore } from "./convexDocumentStore";
import { createConvexMemoryStore } from "./convexMemoryStore";

/**
 * Build a query agent pre-configured with Glass's model routing and Convex storage.
 * Must be called from an action context.
 */
export function buildQueryAgent(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
) {
  const embed = makeEmbedText();

  return createQueryAgent({
    generateText: makeGenerateText("chat"),
    generateObject: makeGenerateObject("chat"),
    documentStore: createConvexDocumentStore(ctx, orgId),
    memoryStore: createConvexMemoryStore(ctx, orgId, embed),
    retrievalLimit: 10,
    maxVerifyRounds: 1,
  });
}

export type { QueryInput, QueryOutput };
