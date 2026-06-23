import { generateText } from "ai";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { haikuModel } from "./ai";

type OrgMemoryType = "fact" | "preference" | "risk_note" | "observation";
type OrgMemorySource = "email" | "imessage";

const ALLOWED_TYPES = new Set<OrgMemoryType>([
  "fact",
  "preference",
  "risk_note",
  "observation",
]);

function cleanJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

export async function extractOrgMemoryFromExchange(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    source: OrgMemorySource;
    exchangeText: string;
    itemLimit: number;
    logPrefix: string;
  },
) {
  try {
    const memoryExtraction = await generateText({
      model: haikuModel,
      maxOutputTokens: args.itemLimit > 3 ? 600 : 400,
      system: `Extract durable facts, preferences, risk notes, or observations about an organization from this ${args.source} exchange.
Output a strict JSON array of up to ${args.itemLimit} items: [{"type":"fact"|"preference"|"risk_note"|"observation","content":string}].
Only include items worth remembering long-term: company details, operational facts, stated preferences, noted risks, or decisions made. Skip pleasantries, one-off questions, and ephemeral requests. If nothing is worth saving, output [].
Output only the JSON array. Do not include prose or code fences.`,
      messages: [{ role: "user", content: args.exchangeText }],
    });

    let parsed: Array<{ type: string; content: string }> = [];
    try {
      const arr = JSON.parse(cleanJsonText(memoryExtraction.text));
      if (Array.isArray(arr)) parsed = arr;
    } catch {
      parsed = [];
    }

    const items = parsed
      .filter(
        (item) =>
          item &&
          typeof item.content === "string" &&
          ALLOWED_TYPES.has(item.type as OrgMemoryType),
      )
      .slice(0, args.itemLimit)
      .map((item) => ({
        orgId: args.orgId,
        type: item.type as OrgMemoryType,
        content: item.content.trim(),
        source: args.source,
      }))
      .filter((item) => item.content.length > 0);

    if (items.length > 0) {
      await ctx.runMutation(internal.orgMemory.bulkInsert, { items });
    }
  } catch (err) {
    console.warn(`${args.logPrefix} orgMemory extraction failed:`, err);
  }
}
