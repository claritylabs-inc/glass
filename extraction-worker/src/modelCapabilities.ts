import type { ModelCapabilities } from "@claritylabs/cl-sdk";

export const EXTRACTION_MODEL_CAPABILITIES: ModelCapabilities = {
  modelName: "gpt-5.4-nano",
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
