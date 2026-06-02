"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import GeminiIcon from "@lobehub/icons/es/Gemini/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Mono";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Mono";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Mono";
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
const EXA_VALUE = "exa";
const SELECT_WIDTH_CLASS = "w-full md:w-80";
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
const PROVIDER_ICONS: Record<
  ProviderId,
  React.ComponentType<{ size?: number | string }>
> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GeminiIcon,
  xai: GrokIcon,
  mistral: MistralIcon,
  cohere: CohereIcon,
  deepseek: DeepSeekIcon,
};

function ProviderLogo({
  provider,
  size = 14,
}: {
  provider: ProviderId;
  size?: number;
}) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon size={size} />;
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

function routeLabel(route: Route) {
  return `${route.provider}:${route.model}`;
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

  const actions = settings?.updatedAt ? (
    <span className="text-label-sm text-muted-foreground">
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
      <main className="mx-auto flex w-full max-w-7xl flex-col">
        {settings === undefined ? (
          <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          </section>
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
                <section
                  key={group.id}
                  className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card"
                >
                  <div className="border-b border-foreground/6 px-4 py-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {group.label}
                    </h3>
                  </div>
                  <div className="divide-y divide-foreground/6 px-4">
                    {tasks.map((task) => {
                      const route = settings.routes[task.id] ?? null;
                      const routeIsDefault = sameRoute(
                        route,
                        task.defaultRoute,
                      );
                      const displayRoute = routeIsDefault ? null : route;
                      const saving = savingTask === task.id;
                      const value = displayRoute
                        ? routeLabel(displayRoute)
                        : DEFAULT_VALUE;

                      function onChange(next: string | null) {
                        if (!next || next === DEFAULT_VALUE) {
                          void commitRoute(task.id, null);
                          return;
                        }
                        const [provider, ...modelParts] = next.split(":");
                        const selectedRoute = {
                          provider: provider as ProviderId,
                          model: modelParts.join(":"),
                        };
                        void commitRoute(
                          task.id,
                          sameRoute(selectedRoute, task.defaultRoute)
                            ? null
                            : selectedRoute,
                        );
                      }

                      return (
                        <div
                          key={task.id}
                          className="grid gap-3 py-3.5 md:grid-cols-[1fr_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-body-sm font-medium text-foreground">
                                {task.label}
                              </p>
                              <span className="rounded-full bg-muted/55 px-2 py-0.5 text-label-sm text-muted-foreground">
                                {displayRoute ? "Override" : "Default"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-label-sm text-muted-foreground/60">
                              {task.description}
                            </p>
                          </div>
                          <div className="flex w-full items-center gap-2 justify-self-start md:w-auto md:justify-self-end">
                            {saving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : null}
                            <Select
                              value={value}
                              onValueChange={onChange}
                              disabled={saving}
                            >
                              <SelectTrigger className={SELECT_WIDTH_CLASS}>
                                <SelectValue>
                                  {displayRoute ? (
                                    <span className="flex items-center gap-2">
                                      <ProviderLogo
                                        provider={displayRoute.provider}
                                      />
                                      <span className="text-body-sm">
                                        {displayRoute.model}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                      <LogoIcon size={14} static />
                                      <span>{task.defaultRoute.model}</span>
                                    </span>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={DEFAULT_VALUE}>
                                  <span className="text-muted-foreground">
                                    Reset to default
                                  </span>
                                </SelectItem>
                                <SelectSeparator />
                                {settings.providers.map((provider) => {
                                  const models = modelsForProvider(
                                    provider.id,
                                    task.isEmbedding,
                                  );
                                  if (models.length === 0) return null;
                                  return (
                                    <SelectGroup key={provider.id}>
                                      <SelectLabel className="flex items-center gap-1.5">
                                        <ProviderLogo
                                          provider={provider.id}
                                          size={12}
                                        />
                                        {provider.label}
                                      </SelectLabel>
                                      {models.map((model) => {
                                        const optionRoute = {
                                          provider: provider.id,
                                          model,
                                        };
                                        const capability =
                                          modelCapabilities[
                                            capabilityKey(optionRoute)
                                          ];
                                        return (
                                          <SelectItem
                                            key={`${provider.id}:${model}`}
                                            value={`${provider.id}:${model}`}
                                          >
                                            <span className="flex min-w-0 items-center justify-between gap-4">
                                              <span className="truncate">
                                                {model}
                                              </span>
                                              <span className="shrink-0 text-label-sm text-muted-foreground/60">
                                                {capabilitySummary(capability)}
                                              </span>
                                            </span>
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectGroup>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                    {group.id === "platform" ? (
                      <div className="grid gap-3 py-3.5 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-body-sm font-medium text-foreground">
                              Web browsing
                            </p>
                            <span className="rounded-full bg-muted/55 px-2 py-0.5 text-label-sm text-muted-foreground">
                              {settings.webRetrieval.primary === "exa"
                                ? "Default"
                                : "Override"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-label-sm text-muted-foreground/60">
                            Public web retrieval for website enrichment and
                            agent web research.
                          </p>
                        </div>
                        <div className="flex w-full items-center gap-2 justify-self-start md:w-auto md:justify-self-end">
                          {savingWebRetrieval ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                          <Select
                            value={
                              settings.webRetrieval.primary === "exa"
                                ? DEFAULT_VALUE
                                : `${settings.webRetrieval.primary}:${settings.webRetrieval.route?.model ?? ""}`
                            }
                            onValueChange={(next) => {
                              if (!next) return;
                              if (
                                next === DEFAULT_VALUE ||
                                next === EXA_VALUE
                              ) {
                                void commitWebRetrieval({ primary: "exa" });
                                return;
                              }
                              const [provider, ...modelParts] = next.split(":");
                              const primary = provider as Exclude<
                                WebRetrievalProviderId,
                                "exa"
                              >;
                              void commitWebRetrieval({
                                primary,
                                route: {
                                  provider: primary,
                                  model: modelParts.join(":"),
                                },
                              });
                            }}
                            disabled={savingWebRetrieval}
                          >
                            <SelectTrigger className={SELECT_WIDTH_CLASS}>
                              <SelectValue>
                                <span className="flex items-center gap-2">
                                  <WebRetrievalLogo
                                    provider={settings.webRetrieval.primary}
                                  />
                                  <span className="text-body-sm">
                                    {settings.webRetrieval.primary === "exa"
                                      ? "Exa"
                                      : settings.webRetrieval.route?.model}
                                  </span>
                                </span>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={DEFAULT_VALUE}>
                                <span className="text-muted-foreground">
                                  Reset to default
                                </span>
                              </SelectItem>
                              <SelectSeparator />
                              {settings.webRetrievalProviders.map(
                                (provider) => {
                                  if (provider.id === "exa") {
                                    return (
                                      <SelectGroup key={provider.id}>
                                        <SelectLabel className="flex items-center gap-1.5">
                                          <WebRetrievalLogo
                                            provider="exa"
                                            size={12}
                                          />
                                          Exa{" "}
                                          {!provider.configured
                                            ? "(missing key)"
                                            : ""}
                                        </SelectLabel>
                                        <SelectItem
                                          value={EXA_VALUE}
                                          disabled={!provider.configured}
                                        >
                                          Exa
                                        </SelectItem>
                                      </SelectGroup>
                                    );
                                  }
                                  if (provider.models.length === 0) return null;
                                  return (
                                    <SelectGroup key={provider.id}>
                                      <SelectLabel className="flex items-center gap-1.5">
                                        <WebRetrievalLogo
                                          provider={provider.id}
                                          size={12}
                                        />
                                        {provider.label}{" "}
                                        {!provider.configured
                                          ? "(missing key)"
                                          : ""}
                                      </SelectLabel>
                                      {provider.models.map((model) => (
                                        <SelectItem
                                          key={`${provider.id}:${model}`}
                                          value={`${provider.id}:${model}`}
                                          disabled={!provider.configured}
                                        >
                                          {model}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  );
                                },
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
