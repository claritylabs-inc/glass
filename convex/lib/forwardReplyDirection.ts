"use node";

import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "./models";
import type { ForwardReplyDirection } from "./inboundEmailParser";

const ForwardReplyDecisionSchema = z.object({
  target: z.enum(["forwarder", "original_sender", "ambiguous"]),
  direction: z.enum(["affirmative", "negated", "absent", "ambiguous"]),
  originalSender: z.string().email().optional(),
  intentEvidence: z.string().max(240),
  confidence: z.number().min(0).max(1),
});

export async function decideForwardReplyDirection(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    currentText: string;
    forwarderEmail: string;
    parsedOriginalSender?: string;
  },
): Promise<ForwardReplyDirection | undefined> {
  if (!args.parsedOriginalSender) return undefined;
  try {
    const { object } = await generateObjectForOrg(
      ctx,
      args.orgId,
      "classification",
      {
        schema: ForwardReplyDecisionSchema,
        maxOutputTokens: 220,
        system: `Decide who Glass is explicitly directed to answer in an internally forwarded email. Default to the forwarding user. Select original_sender only when the forwarding user's current, unquoted text affirmatively tells Glass to reply or respond to that exact original sender. Merely forwarding a message, asking Glass to review it, or quoting headers is not direction. Honor negation. Return the exact supplied original sender address or omit it.`,
        prompt: JSON.stringify({
          currentText: args.currentText,
          forwarderEmail: args.forwarderEmail,
          originalSender: args.parsedOriginalSender,
        }),
      },
    );
    const parsed = ForwardReplyDecisionSchema.safeParse(object);
    if (!parsed.success) return undefined;
    const decision = parsed.data;
    const originalSender = args.parsedOriginalSender.trim().toLowerCase();
    return decision.target === "original_sender" &&
      decision.direction === "affirmative" &&
      decision.confidence >= 0.9 &&
      decision.originalSender?.trim().toLowerCase() === originalSender &&
      Boolean(decision.intentEvidence.trim())
      ? { target: "original_sender", originalSender }
      : undefined;
  } catch {
    return undefined;
  }
}
