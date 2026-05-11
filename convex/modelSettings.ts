import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  EMBEDDING_MODEL_CATALOG,
  LANGUAGE_MODEL_CATALOG,
  MODEL_PROVIDERS,
  MODEL_ROUTING,
  MODEL_TASKS,
  MODEL_TASK_DESCRIPTIONS,
  MODEL_TASK_LABELS,
  PROVIDER_LABELS,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./lib/modelCatalog";

type ProviderKeys = NonNullable<Doc<"brokerModelSettings">["providerKeys"]>;
type Routes = NonNullable<Doc<"brokerModelSettings">["routes"]>;

const providerValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const routeValidator = v.object({
  provider: providerValidator,
  model: v.string(),
});

const routeUpdateValidator = v.union(routeValidator, v.null());

const routesValidator = v.object({
  chat: v.optional(routeUpdateValidator),
  email_draft: v.optional(routeUpdateValidator),
  email_reply: v.optional(routeUpdateValidator),
  extraction: v.optional(routeUpdateValidator),
  classification: v.optional(routeUpdateValidator),
  analysis: v.optional(routeUpdateValidator),
  summary: v.optional(routeUpdateValidator),
  triage: v.optional(routeUpdateValidator),
  email_extraction: v.optional(routeUpdateValidator),
  document_extraction: v.optional(routeUpdateValidator),
  security: v.optional(routeUpdateValidator),
  application_authoring: v.optional(routeUpdateValidator),
  embeddings: v.optional(routeUpdateValidator),
});

function isModelTask(value: string): value is ModelTask {
  return (MODEL_TASKS as string[]).includes(value);
}

function assertSupportedRoute(task: ModelTask, route: ModelRoute) {
  const models = task === "embeddings"
    ? EMBEDDING_MODEL_CATALOG[route.provider]
    : LANGUAGE_MODEL_CATALOG[route.provider];
  if (!models?.includes(route.model)) {
    throw new Error(`Unsupported model ${route.model} for ${PROVIDER_LABELS[route.provider]}`);
  }
}

async function requireCurrentBrokerAdmin(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.role !== "admin") {
    throw new Error("Admin role required to manage model settings");
  }

  const org = await ctx.db.get(membership.orgId);
  if (!org || org.type !== "broker") {
    throw new Error("Expected a broker organization");
  }

  return { userId, brokerOrgId: org._id };
}

function maskProviderKeys(keys: ProviderKeys | undefined) {
  return Object.fromEntries(
    MODEL_PROVIDERS.map((provider) => {
      const value = keys?.[provider];
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

function mergedRoutes(routes: Routes | undefined) {
  return Object.fromEntries(
    MODEL_TASKS.map((task) => [task, routes?.[task] ?? MODEL_ROUTING[task]]),
  ) as Record<ModelTask, ModelRoute>;
}

function visibleRoutes(routes: Routes | undefined, keys: ProviderKeys | undefined) {
  return Object.fromEntries(
    MODEL_TASKS.map((task) => {
      const route = routes?.[task];
      return [task, route && keys?.[route.provider] ? route : null];
    }),
  ) as Record<ModelTask, ModelRoute | null>;
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
      providers: MODEL_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        languageModels: LANGUAGE_MODEL_CATALOG[id],
        embeddingModels: EMBEDDING_MODEL_CATALOG[id] ?? [],
      })),
      tasks: MODEL_TASKS.map((id) => ({
        id,
        label: MODEL_TASK_LABELS[id],
        description: MODEL_TASK_DESCRIPTIONS[id],
        isEmbedding: id === "embeddings",
      })),
      routes: visibleRoutes(settings?.routes, settings?.providerKeys),
      providerKeys: maskProviderKeys(settings?.providerKeys),
      updatedAt: settings?.updatedAt ?? null,
    };
  },
});

export const updateRoutes = mutation({
  args: { routes: routesValidator },
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

    const now = Date.now();
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
    provider: providerValidator,
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

    const now = Date.now();
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

export const resolveForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const brokerOrgId = org.type === "broker" ? org._id : org.brokerOrgId;
    if (!brokerOrgId) return null;

    const settings = await ctx.db
      .query("brokerModelSettings")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
      .first();
    if (!settings) return null;

    return {
      routes: mergedRoutes(settings.routes),
      providerKeys: settings.providerKeys ?? {},
    };
  },
});
