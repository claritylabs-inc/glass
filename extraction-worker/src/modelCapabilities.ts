import type { ModelCapabilities } from "@claritylabs/cl-sdk";
import { MODEL_POLICY_CAPABILITIES } from "./modelRoutingPolicy.js";

const MODEL_CAPABILITIES =
  MODEL_POLICY_CAPABILITIES satisfies Record<string, ModelCapabilities>;

export function modelCapabilitiesForRoute(model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model] ?? {
    modelName: model,
    defaultOutputTokens: 4_096,
  };
}
