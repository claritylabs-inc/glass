"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  getModelDisplayName,
  ModelProviderLogo,
  ModelRouteLogo,
} from "@/components/model-provider-logo";
import { toast } from "sonner";
import { OperatorSidebar } from "../operator-sidebar";
import {
  useCachedOperatorCurrent,
  useCachedOperatorGlobalModelSettings,
  useOperatorGlobalModelRouteCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { formatDisplayDate } from "@/lib/date-format";

type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "deepseek";
type Route = { provider: ProviderId; model: string };
type Routes = Record<string, Route | null>;
type ModelCapability = {
  modelName: string;
  known: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
  taskOutputTokens?: Record<string, number>;
  supportsImageInput?: boolean;
  supportsAudioInput?: boolean;
};
type ProviderConfig = {
  id: ProviderId;
  label: string;
  configured: boolean;
  transport: "direct" | null;
  languageModels: string[];
  audioModels: string[];
  embeddingModels: string[];
};
type TaskConfig = {
  id: string;
  label: string;
  description: string;
  isEmbedding: boolean;
  isAudio: boolean;
  defaultRoute: Route;
};
type TaskGroupConfig = {
  id: string;
  label: string;
  description: string;
  tasks: string[];
};
type Settings = {
  providers: ProviderConfig[];
  tasks: TaskConfig[];
  groups: TaskGroupConfig[];
  routes: Routes;
  modelCapabilities: Record<string, ModelCapability>;
  updatedAt: number | null;
};

const DEFAULT_VALUE = "__default__";
const PROVIDER_SELECT_WIDTH_CLASS = "w-full xl:w-44";
const MODEL_SELECT_WIDTH_CLASS = "w-full xl:w-[30rem]";
const PROVIDER_PRIORITY: ProviderId[] = [
  "fireworks",
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "cohere",
  "deepseek",
];
function ProviderLogo({
  provider,
  size = 14,
}: {
  provider: ProviderId;
  size?: number;
}) {
  return <ModelProviderLogo provider={provider} size={size} />;
}

function sameRoute(left: Route | null, right: Route) {
  return (
    !!left && left.provider === right.provider && left.model === right.model
  );
}

function formatTokens(value: number | undefined) {
  if (!value) return "unknown";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}m`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return value.toLocaleString();
}

function capabilityKey(route: Route) {
  return `${route.provider}:${route.model}`;
}

function capabilitySummary(
  capability: ModelCapability | undefined,
  taskId?: string,
) {
  if (!capability) return "Caps unknown";
  if (!capability.known) {
    return `${formatTokens(capability.defaultOutputTokens)} preferred / n/a`;
  }
  if (taskId === "voice_transcription" && capability.supportsAudioInput) {
    return "Audio transcription";
  }
  const parts = [
    `${formatTokens(capability.maxInputTokens)} in`,
    `${formatTokens(capability.maxOutputTokens)} out`,
  ];
  const taskBudget = taskId ? capability.taskOutputTokens?.[taskId] : undefined;
  if (taskBudget) {
    parts.push(`${formatTokens(taskBudget)} ${taskId}`);
  } else if (capability.defaultOutputTokens) {
    parts.push(`${formatTokens(capability.defaultOutputTokens)} default`);
  }
  return parts.join(" / ");
}

function routeIsDefaultOverride(route: Route, task: TaskConfig) {
  return sameRoute(route, task.defaultRoute) ? null : route;
}

function providerSortIndex(provider: ProviderId) {
  const index = PROVIDER_PRIORITY.indexOf(provider);
  return index === -1 ? PROVIDER_PRIORITY.length : index;
}

export default function OperatorModelsPage() {
  const current = useCachedOperatorCurrent();
  const settings = useCachedOperatorGlobalModelSettings() as
    | Settings
    | undefined;
  const updateRoutes = useMutation(api.modelSettings.updateGlobalRoutes);
  const { patchRoute } = useOperatorGlobalModelRouteCacheActions();
  const [savingTask, setSavingTask] = useState<string | null>(null);

  const providersById = useMemo(() => {
    return Object.fromEntries(
      (settings?.providers ?? []).map((provider) => [provider.id, provider]),
    ) as Record<ProviderId, ProviderConfig>;
  }, [settings?.providers]);
  const modelCapabilities = settings?.modelCapabilities ?? {};

  async function commitRoute(taskId: string, route: Route | null) {
    setSavingTask(taskId);
    try {
      await updateRoutes({ routes: { [taskId]: route } });
      await patchRoute(taskId, route);
      toast.success(route ? "Global model updated" : "Global model reset");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update global model",
      );
    } finally {
      setSavingTask(null);
    }
  }

  function modelsForProvider(
    provider: ProviderId,
    isEmbedding: boolean,
    isAudio: boolean,
  ) {
    const item = providersById[provider];
    return isEmbedding
      ? (item?.embeddingModels ?? [])
      : isAudio
        ? (item?.audioModels ?? [])
        : (item?.languageModels ?? []);
  }

  function providersForTask(task: TaskConfig, selectedProvider: ProviderId) {
    return [...(settings?.providers ?? [])]
      .filter((provider) => {
        const hasModels = modelsForProvider(
          provider.id,
          task.isEmbedding,
          task.isAudio,
        ).length > 0;
        return (
          hasModels && (provider.configured || provider.id === selectedProvider)
        );
      })
      .sort(
        (left, right) =>
          providerSortIndex(left.id) - providerSortIndex(right.id),
      );
  }

  function modelsForSelectedRoute(task: TaskConfig, route: Route) {
    const models = modelsForProvider(
      route.provider,
      task.isEmbedding,
      task.isAudio,
    );
    return models.includes(route.model) ? models : [route.model, ...models];
  }

  function providerTransportLabel(provider: ProviderConfig) {
    if (provider.transport === "direct") return "Env";
    return "Unavailable";
  }

  const actions = settings?.updatedAt ? (
    <span className="text-label text-muted-foreground">
      Updated {formatDisplayDate(settings.updatedAt)}
    </span>
  ) : null;

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail="Models"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="models"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      <main className="flex w-full flex-col">
        {settings === undefined ? (
          <OperationalPanel>
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          </OperationalPanel>
        ) : (
          <div className="grid gap-4">
            {settings.groups.map((group) => {
              const tasks = group.tasks
                .map((taskId) =>
                  settings.tasks.find((task) => task.id === taskId),
                )
                .filter((task): task is TaskConfig => !!task);
              if (tasks.length === 0) return null;
              return (
                <OperationalPanel key={group.id}>
                  <OperationalPanelHeader title={group.label} />
                  <div className="divide-y divide-foreground/6 px-4">
                    {tasks.map((task) => {
                      const route = settings.routes[task.id] ?? null;
                      const routeIsDefault = sameRoute(
                        route,
                        task.defaultRoute,
                      );
                      const displayRoute = routeIsDefault ? null : route;
                      const saving = savingTask === task.id;

                      const selectedRoute = displayRoute ?? task.defaultRoute;
                      const selectedProvider =
                        providersById[selectedRoute.provider];
                      const providerOptions = providersForTask(
                        task,
                        selectedRoute.provider,
                      );
                      const modelOptions = modelsForSelectedRoute(
                        task,
                        selectedRoute,
                      );

                      function commitSelectedRoute(nextRoute: Route) {
                        void commitRoute(
                          task.id,
                          routeIsDefaultOverride(nextRoute, task),
                        );
                      }

                      return (
                        <div
                          key={task.id}
                          className="grid gap-3 py-3.5 xl:grid-cols-[1fr_auto] xl:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-medium text-foreground">
                                {task.label}
                              </p>
                              <span className="rounded-full bg-muted/55 px-2 py-0.5 text-tag text-muted-foreground">
                                {displayRoute ? "Override" : "Default"}
                              </span>
                            </div>
                          </div>
                          <div className="flex w-full flex-col gap-2 justify-self-start xl:w-auto xl:flex-row xl:justify-self-end">
                            {saving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground xl:self-center" />
                            ) : null}
                            <Select
                              value={selectedRoute.provider}
                              onValueChange={(nextProvider) => {
                                if (!nextProvider) return;
                                const provider = nextProvider as ProviderId;
                                const models = modelsForProvider(
                                  provider,
                                  task.isEmbedding,
                                  task.isAudio,
                                );
                                const model = models.includes(selectedRoute.model)
                                  ? selectedRoute.model
                                  : models[0];
                                if (!model) return;
                                commitSelectedRoute({ provider, model });
                              }}
                              disabled={saving}
                            >
                              <SelectTrigger className={PROVIDER_SELECT_WIDTH_CLASS}>
                                <SelectValue>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ProviderLogo
                                      provider={selectedRoute.provider}
                                      size={15}
                                    />
                                    <span className="truncate text-sm">
                                      {selectedProvider?.label ??
                                        selectedRoute.provider}
                                    </span>
                                  </span>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="min-w-56">
                                {providerOptions.map((provider) => (
                                  <SelectItem
                                    key={provider.id}
                                    value={provider.id}
                                    disabled={!provider.configured}
                                  >
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                      <ProviderLogo
                                        provider={provider.id}
                                        size={15}
                                      />
                                      <span className="truncate text-sm">
                                        {provider.label}
                                      </span>
                                      <span className="ml-auto shrink-0 text-label text-muted-foreground/60">
                                        {providerTransportLabel(provider)}
                                      </span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={selectedRoute.model}
                              onValueChange={(model) => {
                                if (!model) return;
                                if (model === DEFAULT_VALUE) {
                                  void commitRoute(task.id, null);
                                  return;
                                }
                                commitSelectedRoute({
                                  provider: selectedRoute.provider,
                                  model,
                                });
                              }}
                              disabled={saving}
                            >
                              <SelectTrigger className={MODEL_SELECT_WIDTH_CLASS}>
                                <SelectValue>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ModelRouteLogo
                                      route={selectedRoute}
                                      size={16}
                                    />
                                    <span
                                      className="min-w-0 truncate text-base"
                                      title={selectedRoute.model}
                                    >
                                      {getModelDisplayName(selectedRoute)}
                                    </span>
                                  </span>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="min-w-[min(42rem,calc(100vw-2rem))]">
                                {displayRoute ? (
                                  <>
                                    <SelectItem value={DEFAULT_VALUE}>
                                      <span className="text-muted-foreground">
                                        Reset to{" "}
                                        {getModelDisplayName(task.defaultRoute)}
                                      </span>
                                    </SelectItem>
                                    <SelectSeparator />
                                  </>
                                ) : null}
                                {modelOptions.map((model) => {
                                  const optionRoute = {
                                    provider: selectedRoute.provider,
                                    model,
                                  };
                                  const capability =
                                    modelCapabilities[
                                      capabilityKey(optionRoute)
                                    ];
                                  return (
                                    <SelectItem key={model} value={model}>
                                      <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                                        <span className="flex min-w-0 items-center gap-2">
                                          <ModelRouteLogo
                                            route={optionRoute}
                                            size={16}
                                          />
                                          <span
                                            className="truncate text-base"
                                            title={model}
                                          >
                                            {getModelDisplayName(optionRoute)}
                                          </span>
                                        </span>
                                        <span className="shrink-0 text-label text-muted-foreground/60">
                                          {capabilitySummary(
                                            capability,
                                            task.id,
                                          )}
                                        </span>
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </OperationalPanel>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
