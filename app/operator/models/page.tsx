"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
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
  useOperatorGlobalModelSettingsCacheActions,
} from "@/lib/sync/operator-cached-queries";

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
type WebRetrievalProviderId = "exa" | "openai" | "google" | "anthropic" | "xai";
type WebRetrieval = { primary: WebRetrievalProviderId; route?: Route };
type ModelCapability = {
  modelName: string;
  known: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
  taskOutputTokens?: Record<string, number>;
};
type ProviderConfig = {
  id: ProviderId;
  label: string;
  configured: boolean;
  transport: "direct" | "gateway" | null;
  languageModels: string[];
  embeddingModels: string[];
};
type TaskConfig = {
  id: string;
  label: string;
  description: string;
  isEmbedding: boolean;
  defaultRoute: Route;
};
type WebRetrievalProviderConfig = {
  id: WebRetrievalProviderId;
  label: string;
  configured: boolean;
  models: string[];
  defaultRoute: Route | null;
};
type Settings = {
  providers: ProviderConfig[];
  tasks: TaskConfig[];
  routes: Routes;
  webRetrieval: WebRetrieval;
  webRetrievalProviders: WebRetrievalProviderConfig[];
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
const WEB_RETRIEVAL_PRIORITY: WebRetrievalProviderId[] = [
  "exa",
  "openai",
  "google",
  "anthropic",
  "xai",
];
const TASK_GROUPS = [
  {
    id: "agents",
    label: "Agent conversations",
    tasks: ["chat", "email_reply", "email_draft", "mailbox_coordinator"],
  },
  {
    id: "reasoning",
    label: "Reasoning and authoring",
    tasks: ["analysis", "application_authoring", "summary"],
  },
  {
    id: "ingestion",
    label: "Ingestion and extraction",
    tasks: [
      "classification",
      "extraction",
      "document_extraction",
      "email_extraction",
    ],
  },
  {
    id: "platform",
    label: "Platform utilities",
    tasks: ["triage", "security", "embeddings"],
  },
] as const;
function ProviderLogo({
  provider,
  size = 14,
}: {
  provider: ProviderId;
  size?: number;
}) {
  return <ModelProviderLogo provider={provider} size={size} />;
}

function ExaLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 151 182"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M150.5 14.1064C150.5 14.3356 150.421 14.5579 150.277 14.736L88.4766 91L150.277 167.264C150.421 167.442 150.5 167.664 150.5 167.894V181C150.5 181.552 150.052 182 149.5 182H1C0.44772 182 0 181.552 0 181V0.999995C0 0.44771 0.447715 0 1 0H149.5C150.052 0 150.5 0.447715 150.5 1V14.1064ZM30.4059 162.719H121.728L76.0664 106.326L30.4059 162.719ZM19.2949 100.261V145.787L56.1572 100.261H19.2949ZM19.2949 80.9801H55.5434L19.2949 36.2121V80.9801ZM76.0664 75.6731L121.728 19.281H30.4059L76.0664 75.6731Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WebRetrievalLogo({
  provider,
  size = 14,
}: {
  provider: WebRetrievalProviderId;
  size?: number;
}) {
  if (provider === "exa") return <ExaLogo size={size} />;
  return <ProviderLogo provider={provider} size={size} />;
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

function webProviderSortIndex(provider: WebRetrievalProviderId) {
  const index = WEB_RETRIEVAL_PRIORITY.indexOf(provider);
  return index === -1 ? WEB_RETRIEVAL_PRIORITY.length : index;
}

function webProviderOptions(
  providers: WebRetrievalProviderConfig[],
  selectedProvider: WebRetrievalProviderId,
) {
  return providers
    .filter((provider) => provider.configured || provider.id === selectedProvider)
    .sort(
      (left, right) =>
        webProviderSortIndex(left.id) - webProviderSortIndex(right.id),
    );
}

function WebBrowsingRouteRow({
  webRetrieval,
  providers,
  saving,
  onCommit,
}: {
  webRetrieval: WebRetrieval;
  providers: WebRetrievalProviderConfig[];
  saving: boolean;
  onCommit: (next: WebRetrieval) => void | Promise<void>;
}) {
  const providersById = Object.fromEntries(
    providers.map((provider) => [provider.id, provider]),
  ) as Partial<Record<WebRetrievalProviderId, WebRetrievalProviderConfig>>;
  const selectedProvider = providersById[webRetrieval.primary];
  const selectedRoute =
    webRetrieval.primary === "exa"
      ? null
      : (webRetrieval.route ?? selectedProvider?.defaultRoute ?? null);
  const selectedModels = selectedProvider?.models ?? [];

  function commitProvider(primary: WebRetrievalProviderId) {
    if (primary === "exa") {
      void onCommit({ primary: "exa" });
      return;
    }

    const provider = providersById[primary];
    const existingModel =
      webRetrieval.primary === primary ? webRetrieval.route?.model : null;
    const model =
      existingModel && provider?.models.includes(existingModel)
        ? existingModel
        : (provider?.defaultRoute?.model ?? provider?.models[0]);
    if (!model) return;

    void onCommit({
      primary,
      route: { provider: primary, model },
    });
  }

  return (
    <div className="grid gap-3 py-3.5 xl:grid-cols-[1fr_auto] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-medium text-foreground">Web browsing</p>
          <span className="rounded-full bg-muted/55 px-2 py-0.5 text-label text-muted-foreground">
            {webRetrieval.primary === "exa" ? "Default" : "Override"}
          </span>
        </div>
        <p className="mt-0.5 text-label text-muted-foreground/60">
          Public web retrieval for website enrichment and agent web research.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 justify-self-start xl:w-auto xl:flex-row xl:justify-self-end">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground xl:self-center" />
        ) : null}
        <Select
          value={webRetrieval.primary}
          onValueChange={(nextProvider) => {
            if (!nextProvider) return;
            commitProvider(nextProvider as WebRetrievalProviderId);
          }}
          disabled={saving}
        >
          <SelectTrigger className={PROVIDER_SELECT_WIDTH_CLASS}>
            <SelectValue>
              <span className="flex min-w-0 items-center gap-2">
                <WebRetrievalLogo provider={webRetrieval.primary} size={15} />
                <span className="truncate text-sm">
                  {selectedProvider?.label ?? webRetrieval.primary}
                </span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-56">
            {webProviderOptions(providers, webRetrieval.primary).map(
              (provider) => (
                <SelectItem
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.configured}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <WebRetrievalLogo provider={provider.id} size={15} />
                    <span className="truncate text-sm">{provider.label}</span>
                    <span className="ml-auto shrink-0 text-label text-muted-foreground/60">
                      {provider.configured ? "Env" : "Unavailable"}
                    </span>
                  </span>
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Select
          value={selectedRoute?.model ?? DEFAULT_VALUE}
          onValueChange={(model) => {
            if (!model || !selectedRoute || webRetrieval.primary === "exa") {
              return;
            }
            void onCommit({
              primary: webRetrieval.primary,
              route: {
                provider: selectedRoute.provider,
                model,
              },
            });
          }}
          disabled={saving || webRetrieval.primary === "exa"}
        >
          <SelectTrigger className={MODEL_SELECT_WIDTH_CLASS}>
            <SelectValue>
              {selectedRoute ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ModelRouteLogo route={selectedRoute} size={16} />
                  <span
                    className="min-w-0 truncate text-base"
                    title={selectedRoute.model}
                  >
                    {getModelDisplayName(selectedRoute)}
                  </span>
                </span>
              ) : (
                <span className="text-base text-muted-foreground">
                  No model
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-[min(42rem,calc(100vw-2rem))]">
            {selectedModels.map((model) => {
              if (!selectedRoute) return null;
              const optionRoute = {
                provider: selectedRoute.provider,
                model,
              };
              return (
                <SelectItem key={model} value={model}>
                  <span className="flex min-w-0 items-center gap-2">
                    <ModelRouteLogo route={optionRoute} size={16} />
                    <span className="truncate text-base" title={model}>
                      {getModelDisplayName(optionRoute)}
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
}

export default function OperatorModelsPage() {
  const current = useCachedOperatorCurrent();
  const settings = useCachedOperatorGlobalModelSettings() as
    | Settings
    | undefined;
  const updateRoutes = useMutation(api.modelSettings.updateGlobalRoutes);
  const updateWebRetrieval = useMutation(
    api.modelSettings.updateGlobalWebRetrieval,
  );
  const { patchRoute, patchWebRetrieval } =
    useOperatorGlobalModelSettingsCacheActions();
  const [savingTask, setSavingTask] = useState<string | null>(null);
  const [savingWebRetrieval, setSavingWebRetrieval] = useState(false);

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

  async function commitWebRetrieval(next: WebRetrieval) {
    setSavingWebRetrieval(true);
    try {
      await updateWebRetrieval({ webRetrieval: next });
      await patchWebRetrieval(next);
      toast.success("Web browsing provider updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update web browsing provider",
      );
    } finally {
      setSavingWebRetrieval(false);
    }
  }

  function modelsForProvider(provider: ProviderId, isEmbedding: boolean) {
    const item = providersById[provider];
    return isEmbedding
      ? (item?.embeddingModels ?? [])
      : (item?.languageModels ?? []);
  }

  function providersForTask(task: TaskConfig, selectedProvider: ProviderId) {
    return [...(settings?.providers ?? [])]
      .filter((provider) => {
        const hasModels =
          modelsForProvider(provider.id, task.isEmbedding).length > 0;
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
    const models = modelsForProvider(route.provider, task.isEmbedding);
    return models.includes(route.model) ? models : [route.model, ...models];
  }

  function providerTransportLabel(provider: ProviderConfig) {
    if (provider.transport === "gateway") return "Gateway";
    if (provider.transport === "direct") return "Env";
    return "Unavailable";
  }

  const actions = settings?.updatedAt ? (
    <span className="text-label text-muted-foreground">
      Updated {dayjs(settings.updatedAt).format("MMM D")}
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
            {TASK_GROUPS.map((group) => {
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
                              <span className="rounded-full bg-muted/55 px-2 py-0.5 text-label text-muted-foreground">
                                {displayRoute ? "Override" : "Default"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-label text-muted-foreground/60">
                              {task.description}
                            </p>
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
                    {group.id === "platform" ? (
                      <WebBrowsingRouteRow
                        webRetrieval={settings.webRetrieval}
                        providers={settings.webRetrievalProviders}
                        saving={savingWebRetrieval}
                        onCommit={commitWebRetrieval}
                      />
                    ) : null}
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
