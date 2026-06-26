import type { ModelCapabilities } from "@claritylabs/cl-sdk";

const OPENAI_GPT_5_4_CAPABILITIES: Omit<ModelCapabilities, "modelName"> = {
  maxInputTokens: 400_000,
  maxOutputTokens: 32_768,
  defaultOutputTokens: 8_192,
  longListOutputTokens: 24_576,
  taskOutputTokens: {
    extraction_classify: 2_048,
    extraction_form_inventory: 8_192,
    extraction_page_map: 8_192,
    extraction_focused: 16_384,
    extraction_long_list: 24_576,
    extraction_review: 12_288,
  },
};

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  "gpt-5.5": { modelName: "gpt-5.5", ...OPENAI_GPT_5_4_CAPABILITIES },
  "gpt-5.4": { modelName: "gpt-5.4", ...OPENAI_GPT_5_4_CAPABILITIES },
  "gpt-5.4-mini": { modelName: "gpt-5.4-mini", ...OPENAI_GPT_5_4_CAPABILITIES },
  "gpt-5.4-nano": { modelName: "gpt-5.4-nano", ...OPENAI_GPT_5_4_CAPABILITIES },
  "claude-haiku-4-5-20251001": {
    modelName: "claude-haiku-4-5-20251001",
    maxInputTokens: 200_000,
    maxOutputTokens: 8_192,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 8_192,
  },
  "accounts/fireworks/models/deepseek-v4-flash": {
    modelName: "accounts/fireworks/models/deepseek-v4-flash",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 32_768,
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
      extraction_classify: 2_048,
      extraction_form_inventory: 8_192,
      extraction_page_map: 8_192,
      extraction_focused: 16_384,
      extraction_long_list: 24_576,
    },
  },
  "accounts/fireworks/models/glm-5p2": {
    modelName: "accounts/fireworks/models/glm-5p2",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 32_768,
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
      extraction_classify: 2_048,
      extraction_form_inventory: 8_192,
      extraction_page_map: 8_192,
      extraction_focused: 16_384,
      extraction_long_list: 24_576,
      extraction_review: 12_288,
      extraction_referential_lookup: 12_288,
    },
  },
  "accounts/fireworks/models/qwen3p7-plus": {
    modelName: "accounts/fireworks/models/qwen3p7-plus",
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 16_384,
    taskOutputTokens: {
      extraction_source_tree: 2_400,
      extraction_operational_profile: 8_192,
      extraction_review: 8_192,
    },
  },
};

export function modelCapabilitiesForRoute(model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model] ?? {
    modelName: model,
    defaultOutputTokens: 4_096,
  };
}
