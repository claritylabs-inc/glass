import { query } from "./_generated/server";
import { MODEL_ROUTING, FALLBACK_MODEL } from "./lib/models";

/**
 * Public query exposing the current AI model routing table.
 * Used by the /weather page. No auth required — contains no secrets.
 */
export const list = query({
  args: {},
  handler: async () => {
    const entries = Object.entries(MODEL_ROUTING).map(([task, info]) => ({
      task,
      model: info.model,
      provider: info.provider,
    }));
    return {
      routes: entries,
      fallback: FALLBACK_MODEL,
    };
  },
});
