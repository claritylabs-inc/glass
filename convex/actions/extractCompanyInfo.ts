"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";

export const extractCompanyInfo = action({
  args: { url: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");

    // Fetch the URL
    const response = await fetch(args.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClarityLabs/1.0)",
      },
    });
    if (!response.ok) {
      return { error: `Failed to fetch website: ${response.status}` };
    }

    let html = await response.text();

    // Strip HTML tags, scripts, styles
    html = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Truncate to ~8000 chars
    if (html.length > 8000) {
      html = html.slice(0, 8000);
    }

    const anthropic = new Anthropic();
    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Based on this website content, extract a brief company description in 2-4 sentences. Include the company's industry, what they do, their approximate size if mentioned, location, and key products/services. Be concise and factual.

Website content:
${html}`,
        },
      ],
    });

    const text =
      result.content[0].type === "text" ? result.content[0].text : "";

    // Save to user profile
    await ctx.runMutation(api.users.updateProfile, {
      companyContext: text,
    });

    return { success: true, companyContext: text };
  },
});
