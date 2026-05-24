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
type Settings = {
  providers: ProviderConfig[];
  tasks: TaskConfig[];
  routes: Routes;
  updatedAt: number | null;
};

const DEFAULT_VALUE = "__default__";
const SELECT_WIDTH_CLASS = "w-full md:w-80";
const PROVIDER_ICONS: Record<ProviderId, React.ComponentType<{ size?: number | string }>> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GeminiIcon,
  xai: GrokIcon,
  mistral: MistralIcon,
  cohere: CohereIcon,
  deepseek: DeepSeekIcon,
};

function ProviderLogo({ provider, size = 14 }: { provider: ProviderId; size?: number }) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon size={size} />;
}

function sameRoute(left: Route | null, right: Route) {
  return !!left && left.provider === right.provider && left.model === right.model;
}

export default function OperatorModelsPage() {
  const current = useCachedOperatorCurrent();
  const settings = useCachedOperatorGlobalModelSettings() as Settings | undefined;
  const updateRoutes = useMutation(api.modelSettings.updateGlobalRoutes);
  const patchCachedRoute = useOperatorGlobalModelSettingsCacheActions();
  const [savingTask, setSavingTask] = useState<string | null>(null);

  const providersById = useMemo(() => {
    return Object.fromEntries((settings?.providers ?? []).map((provider) => [provider.id, provider])) as
      Record<ProviderId, ProviderConfig>;
  }, [settings?.providers]);

  async function commitRoute(taskId: string, route: Route | null) {
    setSavingTask(taskId);
    try {
      await updateRoutes({ routes: { [taskId]: route } });
      await patchCachedRoute(taskId, route);
      toast.success(route ? "Global model updated" : "Global model reset");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update global model");
    } finally {
      setSavingTask(null);
    }
  }

  function modelsForProvider(provider: ProviderId, isEmbedding: boolean) {
    const item = providersById[provider];
    return isEmbedding ? item?.embeddingModels ?? [] : item?.languageModels ?? [];
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
        <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <div className="border-b border-foreground/6 px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">Global model defaults</h2>
            <p className="mt-1 text-label-sm text-muted-foreground/70">
              Used whenever a broker has not set its own provider-backed override.
            </p>
          </div>
          {settings === undefined ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-foreground/6 px-4">
              {settings.tasks.map((task) => {
                const route = settings.routes[task.id] ?? null;
                const routeIsDefault = sameRoute(route, task.defaultRoute);
                const displayRoute = routeIsDefault ? null : route;
                const saving = savingTask === task.id;
                const value = displayRoute ? `${displayRoute.provider}:${displayRoute.model}` : DEFAULT_VALUE;

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
                    sameRoute(selectedRoute, task.defaultRoute) ? null : selectedRoute,
                  );
                }

                return (
                  <div
                    key={task.id}
                    className="grid gap-3 py-2.5 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">{task.label}</p>
                      <p className="text-label-sm text-muted-foreground/60">{task.description}</p>
                    </div>
                    <div className="flex w-full items-center gap-2 justify-self-start md:w-auto md:justify-self-end">
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                      <Select value={value} onValueChange={onChange} disabled={saving}>
                        <SelectTrigger className={SELECT_WIDTH_CLASS}>
                          <SelectValue>
                            {displayRoute ? (
                              <span className="flex items-center gap-2">
                                <ProviderLogo provider={displayRoute.provider} />
                                <span className="text-body-sm">{displayRoute.model}</span>
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
                            <span className="text-muted-foreground">Reset to default</span>
                          </SelectItem>
                          <SelectSeparator />
                          {settings.providers.map((provider) => {
                            const models = modelsForProvider(provider.id, task.isEmbedding);
                            if (models.length === 0) return null;
                            return (
                              <SelectGroup key={provider.id}>
                                <SelectLabel className="flex items-center gap-1.5">
                                  <ProviderLogo provider={provider.id} size={12} />
                                  {provider.label}
                                </SelectLabel>
                                {models.map((model) => (
                                  <SelectItem key={`${provider.id}:${model}`} value={`${provider.id}:${model}`}>
                                    {model}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
