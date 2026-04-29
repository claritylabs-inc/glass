"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { getImessageWorkerUrl, isImessageEnabled } from "../lib/imessageConfig";

/**
 * Sends an intro iMessage from the Photon agent to the authenticated user's
 * phone number via the imessage-worker HTTP /send endpoint.
 *
 * Requires IMESSAGE_WORKER_URL and IMESSAGE_WORKER_SECRET Convex env vars.
 */
export const sendIntroImessage = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");

    const phone = viewer.phone;
    if (!phone) return { ok: false, error: "no_phone" };

    const workerUrl = getImessageWorkerUrl();
    if (!workerUrl) {
      if (isImessageEnabled()) {
        console.warn("[sendIntroImessage] IMESSAGE_WORKER_URL is not set");
      }
      return { ok: false, error: "not_configured" };
    }

    const secret = process.env.IMESSAGE_WORKER_SECRET ?? "";
    const firstName = viewer.name?.split(/\s+/)[0] ?? "there";

    const message =
      `Hi ${firstName}! 👋 I'm your Glass agent. ` +
      `Text me anytime with questions about your insurance — ` +
      `coverage details, COIs, policy comparisons, and more.`;

    try {
      const res = await fetch(`${workerUrl}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ toPhone: phone, message }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[sendIntroImessage] Worker responded ${res.status}: ${body}`);
        return { ok: false, error: "worker_error" };
      }

      return { ok: true };
    } catch (err) {
      console.error("[sendIntroImessage] Failed to reach worker:", err);
      return { ok: false, error: "network_error" };
    }
  },
});
