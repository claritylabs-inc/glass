import {
  MODEL_POLICY_CAPABILITIES,
  MODEL_POLICY_FIREWORKS_MODEL_IDS,
  MODEL_POLICY_QUALITY_ESCALATION_TASK_KINDS,
  MODEL_POLICY_QUALITY_PRIMARY_TASK_KINDS,
  MODEL_POLICY_SPECIAL_ROUTES,
  MODEL_POLICY_TASK_ROUTES,
  modelPolicySupportsImageInput,
} from "../../extraction-worker/src/modelRoutingPolicy";

export type ModelTask =
  | "chat"
  | "email_draft"
  | "email_reply"
  | "extraction"
  | "extraction_preview"
  | "classification"
  | "analysis"
  | "summary"
  | "triage"
  | "email_extraction"
  | "document_extraction"
  | "security"
  | "mailbox_coordinator"
  | "embeddings";

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "moonshot"
  | "deepseek";

export type ModelRoute = {
  provider: ModelProvider;
  model: string;
};

export type WebRetrievalProvider =
  | "exa"
  | "openai"
  | "google"
  | "anthropic"
  | "xai";

export type WebRetrievalRoute = {
  primary: WebRetrievalProvider;
  route?: ModelRoute;
};

export type ModelCapabilityConfig = {
  modelName: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
  taskOutputTokens?: Record<string, number>;
  supportsImageInput?: boolean;
};

export const FIREWORKS_MODEL_IDS = MODEL_POLICY_FIREWORKS_MODEL_IDS;

const RETIRED_MODEL_IDS = new Set<string>([
  "accounts/fireworks/models/kimi-k2p6",
  "accounts/fireworks/routers/kimi-k2p6-fast",
]);

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  mistral: "Mistral",
  cohere: "Cohere",
  fireworks: "Fireworks",
  moonshot: "Disabled provider",
  deepseek: "DeepSeek",
};

export const MODEL_TASK_LABELS: Record<ModelTask, string> = {
  chat: "Chat assistant",
  email_draft: "Email drafting",
  email_reply: "Inbound email replies",
  extraction: "Policy extraction",
  extraction_preview: "Fast policy extraction",
  classification: "Classification",
  analysis: "Reasoning and review",
  summary: "Summaries",
  triage: "Website enrichment",
  email_extraction: "Email extraction",
  document_extraction: "Document extraction",
  security: "Security checks",
  mailbox_coordinator: "Mailbox coordinator",
  embeddings: "Embeddings",
};

export const MODEL_TASK_DESCRIPTIONS: Record<ModelTask, string> = {
  chat:
    "Interactive assistant route for web chat, MCP/CLI chat, iMessage/SMS, broker portfolio Q&A, retrieval orchestration, and tool calls.",
  email_draft:
    "Outbound email drafting route for chat-requested messages, delivery workflows, and email subagent drafts.",
  email_reply:
    "Inbound email reply route for tenant-aware email agent responses.",
  extraction:
    "Standard bound-policy extraction route after LiteParse preprocessing: focused fields, source review, and post-processing.",
  extraction_preview:
    "Fast preview route for policy-list fields extracted from LiteParse text before full enrichment completes.",
  classification:
    "Fast routing route for document kind, request intent, delivery rules, extraction/query classification, and other small decisions.",
  analysis:
    "Deeper reasoning route for coverage analysis, compliance review, partner-program matching, policy reconciliation, and policy-change impact.",
  summary:
    "Summary route for thread titles, COI copy, declaration-discrepancy copy, and compact email/conversation summaries.",
  triage:
    "Website-enrichment synthesis route after public web retrieval; this does not control the web search provider.",
  email_extraction:
    "Low-cost route for extracting structured facts from email body text and supported attachment text.",
  document_extraction:
    "Document-level extraction route for non-policy subtasks and attachment analysis outside full policy extraction.",
  security:
    "Safety route for prompt-injection and unsafe-request classification before agent execution.",
  mailbox_coordinator:
    "Coordinator route for multi-step connected-mailbox workflows: search mail, inspect attachments, import policies or requirements, and plan follow-up.",
  embeddings:
    "Vector embedding route for policies, source chunks, and conversation memory. Must stay compatible with the configured Convex vector dimensions.",
};

export const LANGUAGE_MODEL_CATALOG: Record<ModelProvider, string[]> = {
  openai: [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4-pro",
    "gpt-5.3-chat",
    "gpt-5.3-codex",
    "gpt-5.2",
    "gpt-5.2-chat",
    "gpt-5.2-codex",
    "gpt-5.2-pro",
    "gpt-5.1-instant",
    "gpt-5.1-thinking",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5",
    "gpt-5-chat",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-pro",
    "gpt-5-codex",
    "gpt-oss-120b",
    "gpt-oss-20b",
    "gpt-oss-safeguard-20b",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3",
    "o3-mini",
    "o3-pro",
  ],
  anthropic: [
    "claude-opus-4.7",
    "claude-opus-4.6",
    "claude-opus-4.5",
    "claude-opus-4.1",
    "claude-opus-4",
    "claude-sonnet-4.6",
    "claude-sonnet-4.5",
    "claude-sonnet-4",
    "claude-haiku-4.5",
    "claude-haiku-4-5-20251001",
    "claude-3.5-haiku",
    "claude-3-haiku",
  ],
  google: [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-preview",
    "gemini-3-pro-image",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-image",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
  ],
  xai: [
    "grok-4.3",
    "grok-4.20-reasoning",
    "grok-4.20-non-reasoning",
    "grok-4.20-multi-agent",
    "grok-4.20-reasoning-beta",
    "grok-4.20-non-reasoning-beta",
    "grok-4.20-multi-agent-beta",
    "grok-4.1-fast-reasoning",
    "grok-4.1-fast-non-reasoning",
    "grok-build-0.1",
  ],
  mistral: [
    "mistral-large-3",
    "mistral-medium-3.5",
    "mistral-medium",
    "mistral-small",
    "mistral-nemo",
    "magistral-medium",
    "magistral-small",
    "ministral-14b",
    "ministral-8b",
    "ministral-3b",
    "devstral-2",
    "devstral-small-2",
    "devstral-small",
    "codestral",
    "pixtral-large",
    "pixtral-12b",
  ],
  cohere: ["command-a"],
  fireworks: [
    FIREWORKS_MODEL_IDS.glm52,
    FIREWORKS_MODEL_IDS.qwen37Plus,
    FIREWORKS_MODEL_IDS.deepseekV4Pro,
    FIREWORKS_MODEL_IDS.deepseekV4Flash,
    FIREWORKS_MODEL_IDS.gptOssSafeguard20B,
  ],
  moonshot: [],
  deepseek: [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-v3.2-thinking",
    "deepseek-v3.2",
    "deepseek-v3.1-terminus",
    "deepseek-v3.1",
    "deepseek-v3",
    "deepseek-r1",
  ],
};

export const EMBEDDING_MODEL_CATALOG: Partial<Record<ModelProvider, string[]>> =
  {
    openai: ["text-embedding-3-small", "text-embedding-3-large"],
    google: ["gemini-embedding-001"],
    fireworks: [
      FIREWORKS_MODEL_IDS.qwen3Embedding8B,
      FIREWORKS_MODEL_IDS.nomicEmbedText15,
    ],
  };

export const MODEL_ROUTING =
  MODEL_POLICY_TASK_ROUTES satisfies Record<ModelTask, ModelRoute>;

export const FALLBACK_MODEL =
  MODEL_POLICY_SPECIAL_ROUTES.fallback satisfies ModelRoute;

export const EXTRACTION_QUALITY_MODEL =
  MODEL_POLICY_SPECIAL_ROUTES.extraction_quality satisfies ModelRoute;

export const COVERAGE_CLEANUP_MODEL =
  MODEL_POLICY_SPECIAL_ROUTES.extraction_coverage_cleanup satisfies ModelRoute;

export const QUALITY_PRIMARY_TASK_KINDS =
  MODEL_POLICY_QUALITY_PRIMARY_TASK_KINDS;

export const QUALITY_ESCALATION_TASK_KINDS =
  MODEL_POLICY_QUALITY_ESCALATION_TASK_KINDS;

export const MODEL_TASKS = Object.keys(MODEL_ROUTING) as ModelTask[];
export const EXTRACTION_QUALITY_MODEL_ROUTE_ID = "extraction_quality" as const;
export const EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID =
  "extraction_coverage_cleanup" as const;
export const FALLBACK_MODEL_ROUTE_ID = "fallback" as const;
export type ModelRouteId =
  | ModelTask
  | typeof EXTRACTION_QUALITY_MODEL_ROUTE_ID
  | typeof EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID
  | typeof FALLBACK_MODEL_ROUTE_ID;
export const MODEL_ROUTE_IDS = [
  ...MODEL_TASKS,
  EXTRACTION_QUALITY_MODEL_ROUTE_ID,
  EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
  FALLBACK_MODEL_ROUTE_ID,
] as ModelRouteId[];

export const MODEL_ROUTE_LABELS: Record<ModelRouteId, string> = {
  ...MODEL_TASK_LABELS,
  extraction_quality: "Source tree and profile extraction",
  extraction_coverage_cleanup: "Coverage schedule cleanup",
  fallback: "Fallback model",
};

export const MODEL_ROUTE_DESCRIPTIONS: Record<ModelRouteId, string> = {
  ...MODEL_TASK_DESCRIPTIONS,
  extraction_quality:
    "Proactive primary route for source-tree generation and operational-profile extraction before any failure occurs.",
  extraction_coverage_cleanup:
    "Source-span review route for repairing malformed policy and endorsement coverage schedule rows before persistence.",
  fallback:
    "Retry route after failed high-risk or non-low-cost model calls. Cheap classification and extraction paths do not automatically escalate here.",
};

export function defaultModelRouteForId(id: ModelRouteId): ModelRoute {
  if (id === FALLBACK_MODEL_ROUTE_ID) return FALLBACK_MODEL;
  if (id === EXTRACTION_QUALITY_MODEL_ROUTE_ID) return EXTRACTION_QUALITY_MODEL;
  if (id === EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID) {
    return COVERAGE_CLEANUP_MODEL;
  }
  return MODEL_ROUTING[id];
}

export type ModelRouteGroup<RouteId extends string = string> = {
  id: string;
  label: string;
  description: string;
  tasks: readonly RouteId[];
};

export const MODEL_TASK_GROUPS = [
  {
    id: "agent_communication",
    label: "Agent communication",
    description:
      "Routes used when Glass is talking to users or coordinating mailbox workflows.",
    tasks: ["chat", "email_reply", "email_draft", "mailbox_coordinator"],
  },
  {
    id: "reasoning_authoring",
    label: "Reasoning and authoring",
    description:
      "Routes used for deeper policy reasoning, review, and summaries.",
    tasks: ["analysis", "summary"],
  },
  {
    id: "document_ingestion",
    label: "Document ingestion",
    description:
      "Routes used to classify documents and extract structured facts from policies, files, and email text.",
    tasks: [
      "classification",
      "extraction",
      "document_extraction",
      "email_extraction",
    ],
  },
  {
    id: "platform_utilities",
    label: "Platform utilities",
    description:
      "Routes used for enrichment, safety checks, and vector indexing.",
    tasks: ["triage", "security", "embeddings"],
  },
] as const satisfies readonly ModelRouteGroup<ModelTask>[];

export const OPERATOR_MODEL_ROUTE_GROUPS = [
  MODEL_TASK_GROUPS[0],
  MODEL_TASK_GROUPS[1],
  {
    id: "document_ingestion",
    label: "Document ingestion",
    description:
      "Routes used to classify documents and extract structured facts from policies, files, and email text.",
    tasks: [
      "classification",
      "extraction",
      "extraction_quality",
      "extraction_coverage_cleanup",
      "fallback",
      "document_extraction",
      "email_extraction",
    ],
  },
  MODEL_TASK_GROUPS[3],
] as const satisfies readonly ModelRouteGroup<ModelRouteId>[];

export const MODEL_PROVIDERS = Object.keys(PROVIDER_LABELS) as ModelProvider[];
export const CONFIGURABLE_MODEL_PROVIDERS = MODEL_PROVIDERS.filter(
  (provider) => provider !== "moonshot",
) as Exclude<ModelProvider, "moonshot">[];

export const WEB_RETRIEVAL_LABELS: Record<WebRetrievalProvider, string> = {
  exa: "Exa",
  openai: "OpenAI",
  google: "Google",
  anthropic: "Claude",
  xai: "xAI",
};

export const WEB_RETRIEVAL_DEFAULT: WebRetrievalRoute = { primary: "exa" };

export const WEB_RETRIEVAL_MODEL_CATALOG: Partial<
  Record<Exclude<WebRetrievalProvider, "exa">, string[]>
> = {
  openai: LANGUAGE_MODEL_CATALOG.openai,
  google: LANGUAGE_MODEL_CATALOG.google.filter((model) =>
    model.startsWith("gemini-"),
  ),
  anthropic: LANGUAGE_MODEL_CATALOG.anthropic,
  xai: LANGUAGE_MODEL_CATALOG.xai,
};

export const WEB_RETRIEVAL_DEFAULT_ROUTES: Record<
  Exclude<WebRetrievalProvider, "exa">,
  ModelRoute
> = {
  openai: { provider: "openai", model: "gpt-5.4-mini" },
  google: { provider: "google", model: "gemini-2.5-flash" },
  anthropic: { provider: "anthropic", model: "claude-sonnet-4.5" },
  xai: { provider: "xai", model: "grok-4.20-non-reasoning" },
};

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  [FIREWORKS_MODEL_IDS.deepseekV4Pro]: "DeepSeek V4 Pro",
  [FIREWORKS_MODEL_IDS.deepseekV4Flash]: "DeepSeek V4 Flash",
  [FIREWORKS_MODEL_IDS.glm52]: "GLM 5.2",
  [FIREWORKS_MODEL_IDS.qwen37Plus]: "Qwen 3.7 Plus",
  [FIREWORKS_MODEL_IDS.gptOssSafeguard20B]: "GPT-OSS Safeguard 20B",
  [FIREWORKS_MODEL_IDS.qwen3Embedding8B]: "Qwen3 Embedding 8B",
  [FIREWORKS_MODEL_IDS.nomicEmbedText15]: "Nomic Embed Text v1.5",
  "gpt-5.5": "GPT 5.5",
  "gpt-5.5-pro": "GPT 5.5 Pro",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gpt-5.4-nano": "GPT 5.4 Nano",
  "text-embedding-3-small": "Text Embedding 3 Small",
  "text-embedding-3-large": "Text Embedding 3 Large",
  "claude-sonnet-4.5": "Claude Sonnet 4.5",
  "claude-haiku-4.5": "Claude Haiku 4.5",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
};

export const MODEL_CAPABILITIES =
  MODEL_POLICY_CAPABILITIES satisfies Record<string, ModelCapabilityConfig>;

export function modelCapabilitiesForRoute(
  route: ModelRoute,
): ModelCapabilityConfig | undefined {
  return (
    MODEL_CAPABILITIES[route.model] ?? {
      modelName: route.model,
      defaultOutputTokens: 4_096,
    }
  );
}

export function modelCapabilitiesForTask(
  task: ModelTask,
): ModelCapabilityConfig | undefined {
  return modelCapabilitiesForRoute(MODEL_ROUTING[task]);
}

export function modelSupportsImageInput(route: ModelRoute): boolean {
  return modelPolicySupportsImageInput(route);
}

export function isRetiredModelRoute(
  route: ModelRoute | null | undefined,
): boolean {
  return !!route && RETIRED_MODEL_IDS.has(route.model);
}
