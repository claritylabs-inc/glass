import { query } from "./_generated/server";
import {
  MODEL_ROUTE_LABELS,
  ROUTER_MODEL_ROUTE_IDS,
  PROVIDER_LABELS,
} from "./lib/modelCatalog";
import { resolvePublicModelDefaults } from "./modelSettings";

/**
 * Public query exposing the current AI model routing table.
 * Used by the /weather page. No auth required — contains no secrets.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const config = await resolvePublicModelDefaults(ctx);
    return {
      routes: ROUTER_MODEL_ROUTE_IDS.map((task) => {
        const route = config.routes[task];
        return {
          task,
          taskLabel: MODEL_ROUTE_LABELS[task],
          model: route.model,
          provider: route.provider,
          providerLabel: PROVIDER_LABELS[route.provider],
          routing:
            config.routeSources[task] === "global"
              ? ("manual" as const)
              : ("automatic" as const),
        };
      }),
    };
  },
});
