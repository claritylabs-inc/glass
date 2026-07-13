export type ModelPolicyRoute = {
  provider: string;
  model: string;
};

export type ModelPolicyCapabilityConfig = {
  modelName: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
  taskOutputTokens?: Record<string, number>;
  supportsImageInput?: boolean;
};

export const MODEL_POLICY_FIREWORKS_MODEL_IDS = {
  deepseekV4Pro: "accounts/fireworks/models/deepseek-v4-pro",
  deepseekV4Flash: "accounts/fireworks/models/deepseek-v4-flash",
  glm52: "accounts/fireworks/models/glm-5p2",
  qwen37Plus: "accounts/fireworks/models/qwen3p7-plus",
  gptOssSafeguard20B: "accounts/fireworks/models/gpt-oss-safeguard-20b",
  qwen3Embedding8B: "accounts/fireworks/models/qwen3-embedding-8b",
  nomicEmbedText15: "nomic-ai/nomic-embed-text-v1.5",
} as const;

export const MODEL_POLICY_TASK_ROUTES = {
  chat: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  chat_vision: { provider: "openai", model: "gpt-5.6-terra" },
  email_draft: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52 },
  email_reply: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52 },
  extraction: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  extraction_preview: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  extraction_coverage_recovery: { provider: "openai", model: "gpt-5.4-mini" },
  classification: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  requirement_extraction: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  org_memory_extraction: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  analysis: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52 },
  summary: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52 },
  triage: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  email_extraction: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  document_extraction: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  security: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.gptOssSafeguard20B },
  mailbox_coordinator: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52 },
  embeddings: { provider: "openai", model: "text-embedding-3-small" },
} as const;

export const MODEL_POLICY_SPECIAL_ROUTES = {
  fallback: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Pro },
  extraction_quality: { provider: "fireworks", model: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash },
  extraction_coverage_cleanup: { provider: "openai", model: "gpt-5.4-mini" },
} as const;

export const MODEL_POLICY_QUALITY_PRIMARY_TASK_KINDS = [
  "extraction_source_tree",
  "extraction_operational_profile",
] as const;

export const MODEL_POLICY_QUALITY_ESCALATION_TASK_KINDS = [
  "extraction_source_tree",
  "extraction_operational_profile",
  "extraction_review",
  "extraction_coverage_cleanup",
  "extraction_referential_lookup",
] as const;

export const MODEL_POLICY_IMAGE_CAPABLE_PROVIDER_DEFAULTS = [
  "openai",
  "anthropic",
  "google",
  "xai",
] as const;
const MODEL_POLICY_IMAGE_CAPABLE_PROVIDER_SET = new Set<string>(
  MODEL_POLICY_IMAGE_CAPABLE_PROVIDER_DEFAULTS,
);

const OPENAI_GPT_5_4_CAPABILITIES: Omit<ModelPolicyCapabilityConfig, "modelName"> = {
  maxInputTokens: 400_000,
  maxOutputTokens: 32_768,
  defaultOutputTokens: 8_192,
  longListOutputTokens: 24_576,
  taskOutputTokens: {
    extraction_classify: 2_048,
    extraction_source_tree: 4_096,
    extraction_page_map: 8_192,
    extraction_focused: 16_384,
    extraction_long_list: 24_576,
    extraction_operational_profile: 32_768,
    extraction_coverage_recovery: 16_384,
    extraction_coverage_cleanup: 4_096,
    extraction_review: 12_288,
  },
} as const;

const OPENAI_GPT_5_6_CAPABILITIES: Omit<ModelPolicyCapabilityConfig, "modelName"> = {
  maxInputTokens: 1_050_000,
  maxOutputTokens: 128_000,
  defaultOutputTokens: 8_192,
  longListOutputTokens: 24_576,
  supportsImageInput: true,
  taskOutputTokens: {
    query_reason: 8_192,
    query_verify: 4_096,
    query_respond: 8_192,
  },
} as const;

export const MODEL_POLICY_CAPABILITIES: Record<string, ModelPolicyCapabilityConfig> = {
  "gpt-5.6": { modelName: "gpt-5.6", ...OPENAI_GPT_5_6_CAPABILITIES },
  "gpt-5.6-sol": { modelName: "gpt-5.6-sol", ...OPENAI_GPT_5_6_CAPABILITIES },
  "gpt-5.6-terra": { modelName: "gpt-5.6-terra", ...OPENAI_GPT_5_6_CAPABILITIES },
  "gpt-5.6-luna": { modelName: "gpt-5.6-luna", ...OPENAI_GPT_5_6_CAPABILITIES },
  "gpt-5.5": { modelName: "gpt-5.5", ...OPENAI_GPT_5_4_CAPABILITIES },
  "gpt-5.4": { modelName: "gpt-5.4", ...OPENAI_GPT_5_4_CAPABILITIES },
  "gpt-5.4-mini": {
    modelName: "gpt-5.4-mini",
    ...OPENAI_GPT_5_4_CAPABILITIES,
    supportsImageInput: true,
    taskOutputTokens: {
      ...OPENAI_GPT_5_4_CAPABILITIES.taskOutputTokens,
      query_reason: 8_192,
      query_verify: 4_096,
    },
  },
  "gpt-5.4-nano": { modelName: "gpt-5.4-nano", ...OPENAI_GPT_5_4_CAPABILITIES },
  "claude-haiku-4-5-20251001": {
    modelName: "claude-haiku-4-5-20251001",
    maxInputTokens: 200_000,
    maxOutputTokens: 8_192,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 8_192,
  },
  "claude-haiku-4.5": {
    modelName: "claude-haiku-4.5",
    maxInputTokens: 200_000,
    maxOutputTokens: 8_192,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 8_192,
  },
  "gemini-2.5-flash": {
    modelName: "gemini-2.5-flash",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 65_536,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 16_384,
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Flash,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 32_768,
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
      extraction_classify: 2_048,
      extraction_source_tree: 4_096,
      extraction_preview: 4_096,
      extraction_coverage_recovery: 16_384,
      extraction_coverage_cleanup: 8_192,
      extraction_page_map: 8_192,
      extraction_focused: 16_384,
      extraction_long_list: 24_576,
      extraction_operational_profile: 32_768,
      query_classify: 2_048,
    },
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Pro]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.deepseekV4Pro,
    maxInputTokens: 1_048_576,
    maxOutputTokens: 32_768,
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
      extraction_classify: 2_048,
      extraction_source_tree: 4_096,
      extraction_preview: 4_096,
      extraction_coverage_recovery: 16_384,
      extraction_coverage_cleanup: 8_192,
      extraction_page_map: 8_192,
      extraction_focused: 16_384,
      extraction_long_list: 24_576,
      extraction_operational_profile: 32_768,
      extraction_review: 12_288,
      extraction_referential_lookup: 12_288,
      query_classify: 2_048,
      query_reason: 8_192,
      query_verify: 4_096,
      query_respond: 8_192,
      pce_impact_analysis: 8_192,
      pce_packet_generation: 8_192,
    },
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.qwen37Plus]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.qwen37Plus,
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
    defaultOutputTokens: 4_096,
    longListOutputTokens: 16_384,
    supportsImageInput: true,
    taskOutputTokens: {
      extraction_source_tree: 2_400,
      extraction_coverage_recovery: 16_384,
      extraction_coverage_cleanup: 8_192,
      extraction_operational_profile: 32_768,
      extraction_review: 8_192,
      query_reason: 8_192,
      query_verify: 4_096,
    },
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.glm52,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 32_768,
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
      extraction_classify: 2_048,
      extraction_source_tree: 4_096,
      extraction_preview: 4_096,
      extraction_coverage_recovery: 16_384,
      extraction_coverage_cleanup: 8_192,
      extraction_page_map: 8_192,
      extraction_focused: 16_384,
      extraction_long_list: 24_576,
      extraction_operational_profile: 32_768,
      extraction_review: 12_288,
      extraction_referential_lookup: 12_288,
      query_classify: 2_048,
      query_reason: 8_192,
      query_verify: 4_096,
      query_respond: 8_192,
      pce_impact_analysis: 8_192,
      pce_packet_generation: 8_192,
    },
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.gptOssSafeguard20B]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.gptOssSafeguard20B,
    maxInputTokens: 131_072,
    maxOutputTokens: 8_192,
    defaultOutputTokens: 2_048,
  },
  [MODEL_POLICY_FIREWORKS_MODEL_IDS.qwen3Embedding8B]: {
    modelName: MODEL_POLICY_FIREWORKS_MODEL_IDS.qwen3Embedding8B,
    maxInputTokens: 32_000,
    defaultOutputTokens: 1_536,
  },
} as const;

export function modelPolicySupportsImageInput(route: ModelPolicyRoute): boolean {
  return (
    MODEL_POLICY_CAPABILITIES[route.model]?.supportsImageInput === true ||
    MODEL_POLICY_IMAGE_CAPABLE_PROVIDER_SET.has(route.provider)
  );
}
