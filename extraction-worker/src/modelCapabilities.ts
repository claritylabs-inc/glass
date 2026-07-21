import type { ModelCapabilities } from "@claritylabs/cl-sdk";
import { MODEL_CAPABILITIES as ROUTER_MODEL_CAPABILITIES } from "@claritylabs/cl-router-policy";

const MODEL_CAPABILITIES =
  ROUTER_MODEL_CAPABILITIES satisfies Readonly<Record<string, ModelCapabilities>>;

export function modelCapabilitiesForRoute(model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model] ?? {
    modelName: model,
    defaultOutputTokens: 4_096,
  };
}
