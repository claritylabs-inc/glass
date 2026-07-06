import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateTextForOrg } from "./models";
import { normalizeMemoryContent } from "./orgMemoryPolicy";

type OrgMemoryType = "fact";
type OrgMemorySource = "email" | "imessage";

const ALLOWED_TYPES = new Set<OrgMemoryType>(["fact"]);

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
    const memoryExtraction = await generateTextForOrg(ctx, args.orgId, "org_memory_extraction", {
      maxOutputTokens: args.itemLimit > 3 ? 600 : 400,
      system: `Extract only durable company-profile facts about the organization from this ${args.source} exchange.
Output a strict JSON array of up to ${args.itemLimit} items: [{"type":"fact","content":string}].
Include only stable facts about the company itself, such as legal entity structure, headquarters, operations, products, employees, revenue, ownership, compliance posture, or business activities.
Do not include policy numbers, policy terms, endorsements, COI/certificate details, drafts, recipients, attachments, agent capabilities, tool limitations, workflow status, user requests, one-off tasks, or decisions about a specific transaction. If nothing is worth saving as company context, output [].
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
        content: normalizeMemoryContent(item.content),
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
