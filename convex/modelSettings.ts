import dayjs from "dayjs";
import { v } from "convex/values";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import { requireOperator } from "./lib/operatorIdentity";
import {
  AUDIO_TRANSCRIPTION_MODEL_CATALOG,
  CONFIGURABLE_MODEL_PROVIDERS,
  EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
  EMBEDDING_MODEL_CATALOG,
  EXTRACTION_QUALITY_MODEL_ROUTE_ID,
  FALLBACK_MODEL_ROUTE_ID,
  LANGUAGE_MODEL_CATALOG,
  MODEL_ROUTE_DESCRIPTIONS,
  MODEL_ROUTE_IDS,
  MODEL_ROUTE_LABELS,
  MODEL_ROUTING,
  MODEL_TASK_GROUPS,
  MODEL_TASKS,
  MODEL_TASK_DESCRIPTIONS,
  MODEL_TASK_LABELS,
  OPERATOR_MODEL_ROUTE_GROUPS,
  MODEL_CAPABILITIES,
  PROVIDER_LABELS,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  WEB_RETRIEVAL_LABELS,
  WEB_RETRIEVAL_MODEL_CATALOG,
  directProviderModelForRoute,
  isWebRetrievalApiProvider,
  isRetiredModelRoute,
  modelCapabilitiesForRoute,
  modelRouteSupportsTask,
  type ModelProvider,
  type ModelRoute,
  type ModelRouteId,
  type ModelTask,
  type WebRetrievalProvider,
  type WebRetrievalRoute,
  defaultModelRouteForId,
} from "./lib/modelCatalog";

type ProviderKeys = NonNullable<Doc<"brokerModelSettings">["providerKeys"]>;
type Routes = NonNullable<Doc<"brokerModelSettings">["routes"]>;
type GlobalRoutes = Partial<Record<ModelRouteId, ModelRoute>>;
type RouteSource = "broker" | "global" | "static";
const CONFIGURABLE_PROVIDER_SET = new Set<ModelProvider>(CONFIGURABLE_MODEL_PROVIDERS);

const configurableProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("deepseek"),
);

const routeValidator = v.object({
  provider: configurableProviderValidator,
  model: v.string(),
});

const routeUpdateValidator = v.union(routeValidator, v.null());

const webRetrievalProviderValidator = v.union(
  v.literal("parallel"),
  v.literal("exa"),
  v.literal("openai"),
  v.literal("google"),
  v.literal("anthropic"),
  v.literal("xai"),
);

const webRetrievalValidator = v.object({
  primary: webRetrievalProviderValidator,
  route: v.optional(routeValidator),
});

const modelTaskRoutesValidator = v.object({
  chat: v.optional(routeUpdateValidator),
  chat_vision: v.optional(routeUpdateValidator),
  voice_transcription: v.optional(routeUpdateValidator),
  email_draft: v.optional(routeUpdateValidator),
  email_reply: v.optional(routeUpdateValidator),
  extraction: v.optional(routeUpdateValidator),
  extraction_preview: v.optional(routeUpdateValidator),
  extraction_coverage_recovery: v.optional(routeUpdateValidator),
  classification: v.optional(routeUpdateValidator),
  requirement_extraction: v.optional(routeUpdateValidator),
  org_memory_extraction: v.optional(routeUpdateValidator),
  analysis: v.optional(routeUpdateValidator),
  summary: v.optional(routeUpdateValidator),
  triage: v.optional(routeUpdateValidator),
  email_extraction: v.optional(routeUpdateValidator),
  document_extraction: v.optional(routeUpdateValidator),
  security: v.optional(routeUpdateValidator),
  mailbox_coordinator: v.optional(routeUpdateValidator),
  embeddings: v.optional(routeUpdateValidator),
});

const globalRoutesValidator = v.object({
  chat: v.optional(routeUpdateValidator),
  chat_vision: v.optional(routeUpdateValidator),
  voice_transcription: v.optional(routeUpdateValidator),
  email_draft: v.optional(routeUpdateValidator),
  email_reply: v.optional(routeUpdateValidator),
  extraction: v.optional(routeUpdateValidator),
  extraction_preview: v.optional(routeUpdateValidator),
  extraction_coverage_recovery: v.optional(routeUpdateValidator),
  classification: v.optional(routeUpdateValidator),
  requirement_extraction: v.optional(routeUpdateValidator),
  org_memory_extraction: v.optional(routeUpdateValidator),
  analysis: v.optional(routeUpdateValidator),
  summary: v.optional(routeUpdateValidator),
  triage: v.optional(routeUpdateValidator),
  email_extraction: v.optional(routeUpdateValidator),
  document_extraction: v.optional(routeUpdateValidator),
  security: v.optional(routeUpdateValidator),
  mailbox_coordinator: v.optional(routeUpdateValidator),
  embeddings: v.optional(routeUpdateValidator),
  extraction_quality: v.optional(routeUpdateValidator),
  extraction_coverage_cleanup: v.optional(routeUpdateValidator),
  fallback: v.optional(routeUpdateValidator),
});

function isModelTask(value: string): value is ModelTask {
  return (MODEL_TASKS as string[]).includes(value);
}

function isModelRouteId(value: string): value is ModelRouteId {
  return (MODEL_ROUTE_IDS as string[]).includes(value);
}

function assertSupportedRoute(routeId: ModelRouteId, route: ModelRoute) {
  if (isRetiredModelRoute(route)) {
    throw new Error(`Retired model ${route.model} is no longer selectable`);
  }
  if (!directProviderModelForRoute(route)) {
    throw new Error(
      `${PROVIDER_LABELS[route.provider]} model ${route.model} is not available through direct provider routing`,
    );
  }
  const models = routeId === "embeddings"
    ? EMBEDDING_MODEL_CATALOG[route.provider]
    : routeId === "voice_transcription"
      ? AUDIO_TRANSCRIPTION_MODEL_CATALOG[route.provider]
      : LANGUAGE_MODEL_CATALOG[route.provider];
  if (!models?.includes(route.model)) {
    throw new Error(`Unsupported model ${route.model} for ${PROVIDER_LABELS[route.provider]}`);
  }
  if (
    isModelTask(routeId) &&
    !modelRouteSupportsTask(routeId, route)
  ) {
    throw new Error(
      routeId === "voice_transcription"
        ? `${MODEL_TASK_LABELS[routeId]} requires an audio transcription model`
        : `${MODEL_TASK_LABELS[routeId]} requires an image-capable model`,
    );
  }
}

function isConfigurableProvider(provider: ModelProvider) {
  return CONFIGURABLE_PROVIDER_SET.has(provider);
}

async function requireCurrentBrokerAdmin(ctx: QueryCtx | MutationCtx) {
  const access = await requireOrgAccess(ctx);
  if (access.role !== "admin") {
    throw new Error("Admin role required to manage model settings");
  }

  if (access.org.type !== "broker") {
    throw new Error("Expected a broker organization");
  }

  return { userId: access.userId, brokerOrgId: access.orgId };
}

function maskProviderKeys(keys: ProviderKeys | undefined) {
  return Object.fromEntries(
    CONFIGURABLE_MODEL_PROVIDERS.map((provider) => {
      const value = keys?.[provider]?.trim();
      return [
        provider,
        {
          configured: !!value,
          suffix: value ? value.slice(-4) : null,
        },
      ];
    }),
  ) as Record<ModelProvider, { configured: boolean; suffix: string | null }>;
}

function configuredEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function languageProviderEnvConfigured(provider: ModelProvider) {
  switch (provider) {
    case "fireworks":
      return !!configuredEnv(process.env.FIREWORKS_API_KEY);
    case "openai":
      return !!configuredEnv(process.env.OPENAI_API_KEY);
    case "anthropic":
      return !!configuredEnv(process.env.ANTHROPIC_API_KEY);
    case "google":
      return !!(
        configuredEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ??
        configuredEnv(process.env.GOOGLE_API_KEY)
      );
    case "xai":
      return !!configuredEnv(process.env.XAI_API_KEY);
    case "mistral":
      return !!configuredEnv(process.env.MISTRAL_API_KEY);
    case "cohere":
      return !!configuredEnv(process.env.COHERE_API_KEY);
    case "deepseek":
      return !!configuredEnv(process.env.DEEPSEEK_API_KEY);
    case "moonshot":
      return false;
  }
}

function routeDirectlyConfigured(route: ModelRoute) {
  return (
    !!directProviderModelForRoute(route) &&
    languageProviderEnvConfigured(route.provider)
  );
}

function providerTransport(provider: ModelProvider) {
  if (!languageProviderEnvConfigured(provider)) return null;
  const routes = [
    ...(LANGUAGE_MODEL_CATALOG[provider] ?? []),
    ...(AUDIO_TRANSCRIPTION_MODEL_CATALOG[provider] ?? []),
    ...(EMBEDDING_MODEL_CATALOG[provider] ?? []),
  ];
  return routes.some((model) => directProviderModelForRoute({ provider, model }))
    ? "direct"
    : null;
}

function globalProviderConfigured(provider: ModelProvider) {
  return providerTransport(provider) !== null;
}

function visibleRoutes(routes: Routes | undefined, keys: ProviderKeys | undefined) {
  return Object.fromEntries(
    MODEL_TASKS.map((task) => {
      const route = routes?.[task];
      return [
        task,
        route &&
        !isRetiredModelRoute(route) &&
        directProviderModelForRoute(route) &&
        isConfigurableProvider(route.provider) &&
        keys?.[route.provider]
          ? route
          : null,
      ];
    }),
  ) as Record<ModelTask, ModelRoute | null>;
}

function nullableGlobalRoutes(routes: GlobalRoutes | undefined) {
  return Object.fromEntries(
    MODEL_ROUTE_IDS.map((id) => {
      const route = routes?.[id];
      return [
        id,
        route && !isRetiredModelRoute(route) && routeDirectlyConfigured(route)
          ? route
          : null,
      ];
    }),
  ) as Record<ModelRouteId, ModelRoute | null>;
}

function availableLanguageModels(provider: ModelProvider) {
  return (LANGUAGE_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function availableEmbeddingModels(provider: ModelProvider) {
  return (EMBEDDING_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function availableAudioModels(provider: ModelProvider) {
  return (AUDIO_TRANSCRIPTION_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function configurableProviderKeys(keys: ProviderKeys | undefined) {
  return Object.fromEntries(
    CONFIGURABLE_MODEL_PROVIDERS.flatMap((provider) => {
      const value = keys?.[provider]?.trim();
      return value ? [[provider, value]] : [];
    }),
  ) as ProviderKeys;
}

function webRetrievalEnvConfigured(provider: WebRetrievalProvider) {
  switch (provider) {
    case "parallel":
      return !!configuredEnv(process.env.PARALLEL_API_KEY);
    case "exa":
      return !!configuredEnv(process.env.EXA_API_KEY);
    case "openai":
      return !!configuredEnv(process.env.OPENAI_API_KEY);
    case "google":
      return !!(
        configuredEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ??
        configuredEnv(process.env.GOOGLE_API_KEY)
      );
    case "anthropic":
      return !!configuredEnv(process.env.ANTHROPIC_API_KEY);
    case "xai":
      return !!configuredEnv(process.env.XAI_API_KEY);
  }
}

function normalizeWebRetrieval(config: WebRetrievalRoute | undefined): WebRetrievalRoute {
  if (!config) return WEB_RETRIEVAL_DEFAULT;
  if (isWebRetrievalApiProvider(config.primary)) return { primary: config.primary };
  return {
    primary: config.primary,
    route: config.route ?? WEB_RETRIEVAL_DEFAULT_ROUTES[config.primary],
  };
}

function assertSupportedWebRetrieval(config: WebRetrievalRoute) {
  if (isWebRetrievalApiProvider(config.primary)) {
    if (config.route) {
      throw new Error(`${WEB_RETRIEVAL_LABELS[config.primary]} web retrieval does not use a model route`);
    }
    return;
  }
  const route = config.route ?? WEB_RETRIEVAL_DEFAULT_ROUTES[config.primary];
  if (route.provider !== config.primary) {
    throw new Error("Web retrieval route provider must match the selected provider");
  }
  const models = WEB_RETRIEVAL_MODEL_CATALOG[config.primary];
  if (!models?.includes(route.model)) {
    throw new Error(`Unsupported web retrieval model ${route.model}`);
  }
}

function modelCapabilityCatalog() {
  return Object.fromEntries(
    CONFIGURABLE_MODEL_PROVIDERS.flatMap((provider) =>
      [
        ...(LANGUAGE_MODEL_CATALOG[provider] ?? []),
        ...(AUDIO_TRANSCRIPTION_MODEL_CATALOG[provider] ?? []),
        ...(EMBEDDING_MODEL_CATALOG[provider] ?? []),
      ].map((model) => {
        const capabilities = modelCapabilitiesForRoute({ provider, model });
        return [
          `${provider}:${model}`,
          {
            ...capabilities,
            known: Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, model),
          },
        ];
      }),
    ),
  );
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const { brokerOrgId } = await requireCurrentBrokerAdmin(ctx);
    const settings = await ctx.db
      .query("brokerModelSettings")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
      .first();

    return {
      providers: CONFIGURABLE_MODEL_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        languageModels: availableLanguageModels(id),
        audioModels: availableAudioModels(id),
        embeddingModels: availableEmbeddingModels(id),
      })),
      tasks: MODEL_TASKS.map((id) => ({
        id,
        label: MODEL_TASK_LABELS[id],
        description: MODEL_TASK_DESCRIPTIONS[id],
        isEmbedding: id === "embeddings",
        isAudio: id === "voice_transcription",
      })),
      groups: MODEL_TASK_GROUPS,
      routes: visibleRoutes(settings?.routes, settings?.providerKeys),
      providerKeys: maskProviderKeys(settings?.providerKeys),
      updatedAt: settings?.updatedAt ?? null,
    };
  },
});

export const updateRoutes = mutation({
  args: { routes: modelTaskRoutesValidator },
  handler: async (ctx, args) => {
    const { userId, brokerOrgId } = await requireCurrentBrokerAdmin(ctx);

    const existing = await ctx.db
      .query("brokerModelSettings")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
      .first();
    const providerKeys = existing?.providerKeys ?? {};

    for (const [task, route] of Object.entries(args.routes)) {
      if (!route) continue;
      if (!isModelTask(task)) throw new Error(`Unknown model task ${task}`);
      if (!providerKeys[route.provider]) {
        throw new Error(`Add a ${PROVIDER_LABELS[route.provider]} API key before selecting its models`);
      }
      assertSupportedRoute(task, route);
    }

    const now = dayjs().valueOf();
    const routes = { ...(existing?.routes ?? {}) };
    for (const [task, route] of Object.entries(args.routes)) {
      if (!isModelTask(task)) continue;
      if (route === null) {
        delete routes[task];
      } else if (route) {
        routes[task] = route;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, { routes, updatedBy: userId, updatedAt: now });
    } else {
      await ctx.db.insert("brokerModelSettings", {
        brokerOrgId,
        routes,
        updatedBy: userId,
        updatedAt: now,
      });
    }
  },
});

export const updateProviderKey = mutation({
  args: {
    provider: configurableProviderValidator,
    apiKey: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const { userId, brokerOrgId } = await requireCurrentBrokerAdmin(ctx);
    const existing = await ctx.db
      .query("brokerModelSettings")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
      .first();
    const providerKeys = { ...(existing?.providerKeys ?? {}) };
    const nextKey = args.apiKey?.trim() ?? "";
    if (nextKey) {
      providerKeys[args.provider] = nextKey;
    } else {
      delete providerKeys[args.provider];
    }

    const now = dayjs().valueOf();
    if (existing) {
      await ctx.db.patch(existing._id, { providerKeys, updatedBy: userId, updatedAt: now });
    } else {
      await ctx.db.insert("brokerModelSettings", {
        brokerOrgId,
        providerKeys,
        updatedBy: userId,
        updatedAt: now,
      });
    }
  },
});

export const getGlobal = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    return {
      providers: CONFIGURABLE_MODEL_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        configured: globalProviderConfigured(id),
        transport: providerTransport(id),
        languageModels: availableLanguageModels(id),
        audioModels: availableAudioModels(id),
        embeddingModels: availableEmbeddingModels(id),
      })),
      tasks: MODEL_ROUTE_IDS.map((id) => ({
        id,
        label: MODEL_ROUTE_LABELS[id],
        description: MODEL_ROUTE_DESCRIPTIONS[id],
        isEmbedding: id === "embeddings",
        isAudio: id === "voice_transcription",
        defaultRoute: defaultModelRouteForId(id),
      })),
      groups: OPERATOR_MODEL_ROUTE_GROUPS,
      routes: nullableGlobalRoutes(settings?.routes as GlobalRoutes | undefined),
      webRetrieval: normalizeWebRetrieval(settings?.webRetrieval),
      webRetrievalProviders: (
        Object.keys(WEB_RETRIEVAL_LABELS) as WebRetrievalProvider[]
      ).map((id) => ({
          id,
          label: WEB_RETRIEVAL_LABELS[id],
          configured: webRetrievalEnvConfigured(id),
          models: isWebRetrievalApiProvider(id)
            ? []
            : (WEB_RETRIEVAL_MODEL_CATALOG[id] ?? []),
          defaultRoute: isWebRetrievalApiProvider(id)
            ? null
            : WEB_RETRIEVAL_DEFAULT_ROUTES[id],
        }),
      ),
      modelCapabilities: modelCapabilityCatalog(),
      updatedAt: settings?.updatedAt ?? null,
    };
  },
});

export const updateGlobalRoutes = mutation({
  args: { routes: globalRoutesValidator },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const existing = await ctx.db
      .query("globalModelSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    for (const [task, route] of Object.entries(args.routes)) {
      if (!route) continue;
      if (!isModelRouteId(task)) throw new Error(`Unknown model route ${task}`);
      assertSupportedRoute(task, route);
      if (!routeDirectlyConfigured(route)) {
        throw new Error(
          `${PROVIDER_LABELS[route.provider]} is not configured for direct model routing`,
        );
      }
    }

    const now = dayjs().valueOf();
    const routes = { ...(existing?.routes ?? {}) } as GlobalRoutes;
    for (const [task, route] of Object.entries(args.routes)) {
      if (!isModelRouteId(task)) continue;
      if (route === null) {
        delete routes[task];
      } else if (route) {
        routes[task] = route;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, { routes, updatedBy: operator.userId, updatedAt: now });
    } else {
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        routes,
        updatedBy: operator.userId,
        updatedAt: now,
      });
    }
  },
});

export const updateGlobalWebRetrieval = mutation({
  args: { webRetrieval: webRetrievalValidator },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    assertSupportedWebRetrieval(args.webRetrieval);

    const existing = await ctx.db
      .query("globalModelSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const now = dayjs().valueOf();
    const webRetrieval = normalizeWebRetrieval(args.webRetrieval);

    if (existing) {
      await ctx.db.patch(existing._id, {
        webRetrieval,
        updatedBy: operator.userId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        webRetrieval,
        updatedBy: operator.userId,
        updatedAt: now,
      });
    }
  },
});

export const resolveForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const brokerOrgId = org.type === "broker" ? org._id : org.brokerOrgId;

    const globalSettings = await ctx.db
      .query("globalModelSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const settings = brokerOrgId
      ? await ctx.db
        .query("brokerModelSettings")
        .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
        .first()
      : null;

    const providerKeys = configurableProviderKeys(settings?.providerKeys);
    const globalRoutes = globalSettings?.routes as GlobalRoutes | undefined;
    const routes = {} as Record<ModelRouteId, ModelRoute>;
    const routeSources = {} as Record<ModelRouteId, RouteSource>;
    for (const task of MODEL_TASKS) {
      const brokerRoute = settings?.routes?.[task];
      if (
        brokerRoute &&
        brokerRoute.provider !== "moonshot" &&
        !isRetiredModelRoute(brokerRoute) &&
        directProviderModelForRoute(brokerRoute) &&
        modelRouteSupportsTask(task, brokerRoute) &&
        providerKeys[brokerRoute.provider]
      ) {
        routes[task] = brokerRoute;
        routeSources[task] = "broker";
        continue;
      }
      const globalRoute = globalRoutes?.[task];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        !isRetiredModelRoute(globalRoute) &&
        modelRouteSupportsTask(task, globalRoute) &&
        routeDirectlyConfigured(globalRoute)
      ) {
        routes[task] = globalRoute;
        routeSources[task] = "global";
        continue;
      }
      routes[task] = MODEL_ROUTING[task];
      routeSources[task] = "static";
    }
    for (const routeId of [
      EXTRACTION_QUALITY_MODEL_ROUTE_ID,
      EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
      FALLBACK_MODEL_ROUTE_ID,
    ]) {
      const globalRoute = globalRoutes?.[routeId];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        !isRetiredModelRoute(globalRoute) &&
        routeDirectlyConfigured(globalRoute)
      ) {
        routes[routeId] = globalRoute;
        routeSources[routeId] = "global";
      } else {
        routes[routeId] = defaultModelRouteForId(routeId);
        routeSources[routeId] = "static";
      }
    }

    return {
      routes,
      routeSources,
      providerKeys,
      webRetrieval: normalizeWebRetrieval(globalSettings?.webRetrieval),
    };
  },
});

export const resolvePublicDefaults = internalQuery({
  args: {},
  handler: async (ctx) => {
    const globalSettings = await ctx.db
      .query("globalModelSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const globalRoutes = globalSettings?.routes as GlobalRoutes | undefined;
    const routes = {} as Record<ModelRouteId, ModelRoute>;
    const routeSources = {} as Record<ModelRouteId, Extract<RouteSource, "global" | "static">>;
    for (const task of MODEL_TASKS) {
      const globalRoute = globalRoutes?.[task];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        !isRetiredModelRoute(globalRoute) &&
        modelRouteSupportsTask(task, globalRoute) &&
        routeDirectlyConfigured(globalRoute)
      ) {
        routes[task] = globalRoute;
        routeSources[task] = "global";
      } else {
        routes[task] = MODEL_ROUTING[task];
        routeSources[task] = "static";
      }
    }
    for (const routeId of [
      EXTRACTION_QUALITY_MODEL_ROUTE_ID,
      EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
      FALLBACK_MODEL_ROUTE_ID,
    ]) {
      const globalRoute = globalRoutes?.[routeId];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        !isRetiredModelRoute(globalRoute) &&
        routeDirectlyConfigured(globalRoute)
      ) {
        routes[routeId] = globalRoute;
        routeSources[routeId] = "global";
      } else {
        routes[routeId] = defaultModelRouteForId(routeId);
        routeSources[routeId] = "static";
      }
    }

    return {
      routes,
      routeSources,
      webRetrieval: normalizeWebRetrieval(globalSettings?.webRetrieval),
    };
  },
});
