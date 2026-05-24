"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Loader2, Plus, Trash2 } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import GeminiIcon from "@lobehub/icons/es/Gemini/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Mono";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Mono";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Mono";
import { toast } from "sonner";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

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
};
type Settings = {
  providers: ProviderConfig[];
  tasks: TaskConfig[];
  routes: Routes;
  providerKeys: Record<ProviderId, { configured: boolean; suffix: string | null }>;
  updatedAt: number | null;
};

const VISIBLE_PROVIDERS: ProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "cohere",
  "deepseek",
];
const DEFAULT_VALUE = "__default__";

const PROVIDER_ICONS: Record<ProviderId, React.ComponentType<{ size?: number | string }>> = {
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
  className,
  size = 16,
}: {
  provider: ProviderId;
  className?: string;
  size?: number;
}) {
  const Icon = PROVIDER_ICONS[provider];
  return (
    <span className={className} style={{ display: "inline-flex" }}>
      <Icon size={size} />
    </span>
  );
}

export function ModelsSection() {
  const settings = useCachedQuery(
    "settings.modelSettings.get",
    api.modelSettings.get,
    {},
  ) as Settings | undefined;
  const updateRoutes = useMutation(api.modelSettings.updateRoutes);
  const updateProviderKey = useMutation(api.modelSettings.updateProviderKey);
  const patchSettings = useUpdateCachedQuery<Settings, Record<string, never>>(
    "settings.modelSettings.get",
  );
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ProviderId[]>([]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const providersById = useMemo(() => {
    return Object.fromEntries((settings?.providers ?? []).map((p: ProviderConfig) => [p.id, p])) as
      Record<ProviderId, ProviderConfig>;
  }, [settings?.providers]);

  if (settings === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const loadedSettings = settings;
  const visibleProviders = loadedSettings.providers.filter((p) =>
    VISIBLE_PROVIDERS.includes(p.id),
  );

  async function commitProviderKey(provider: ProviderId, apiKey: string | null) {
    setSavingProvider(provider);
    try {
      await updateProviderKey({ provider, apiKey });
      await patchSettings({}, (current) => ({
        ...current,
        providerKeys: {
          ...current.providerKeys,
          [provider]: {
            configured: !!apiKey,
            suffix: apiKey ? apiKey.slice(-4) : null,
          },
        },
        updatedAt: dayjs().valueOf(),
      }));
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      setDrafts((current) => current.filter((id) => id !== provider));
      toast.success(apiKey ? "Provider key saved" : "Provider key removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update provider key");
    } finally {
      setSavingProvider(null);
    }
  }

  function dismissDraft(provider: ProviderId) {
    setDrafts((current) => current.filter((id) => id !== provider));
    setApiKeys((current) => ({ ...current, [provider]: "" }));
  }

  async function commitRoute(taskId: string, route: Route | null) {
    setSavingTask(taskId);
    try {
      await updateRoutes({ routes: { [taskId]: route } });
      await patchSettings({}, (current) => ({
        ...current,
        routes: {
          ...current.routes,
          [taskId]: route,
        },
        updatedAt: dayjs().valueOf(),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update model routing");
    } finally {
      setSavingTask(null);
    }
  }

  function modelsForProvider(provider: ProviderId, isEmbedding: boolean) {
    const item = providersById[provider];
    return isEmbedding ? item?.embeddingModels ?? [] : item?.languageModels ?? [];
  }

  function configuredProviders(isEmbedding: boolean) {
    return visibleProviders.filter((provider) => {
      return (
        loadedSettings.providerKeys[provider.id].configured &&
        modelsForProvider(provider.id, isEmbedding).length > 0
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/6 flex items-center justify-between gap-3">
          <h3 className="mb-0! text-sm font-medium text-foreground">Provider keys</h3>
          {(() => {
            const addable = visibleProviders.filter(
              (p) => !loadedSettings.providerKeys[p.id].configured && !drafts.includes(p.id),
            );
            if (addable.length === 0) return null;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <PillButton type="button" size="compact" variant="secondary">
                    <Plus className="w-3.5 h-3.5" />
                    Add provider
                  </PillButton>
                } />
                <DropdownMenuContent align="end">
                  {addable.map((provider) => (
                    <DropdownMenuItem
                      key={provider.id}
                      onClick={() => {
                        setDrafts((current) => [...current, provider.id]);
                        setTimeout(() => inputRefs.current[provider.id]?.focus(), 0);
                      }}
                      className="gap-2.5"
                    >
                      <ProviderLogo provider={provider.id} size={14} />
                      <span>{provider.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })()}
        </div>
        {(() => {
          const rows = visibleProviders.filter(
            (p) => loadedSettings.providerKeys[p.id].configured || drafts.includes(p.id),
          );
          if (rows.length === 0) {
            return (
              <div className="px-4 py-10 text-center">
                <p className="text-body font-medium text-foreground">No provider keys</p>
                <p className="text-body-sm text-muted-foreground/70 mt-1.5 max-w-sm mx-auto">
                  Add an OpenAI or Anthropic key to use your own models.
                </p>
              </div>
            );
          }
          return (
            <div className="px-4 divide-y divide-foreground/6">
              {rows.map((provider) => {
                const keyState = settings.providerKeys[provider.id];
                const saving = savingProvider === provider.id;
                const draft = apiKeys[provider.id] ?? "";
                const isDraft = !keyState.configured;
                return (
                  <div
                    key={provider.id}
                    className="py-2.5 grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-center"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ProviderLogo
                        provider={provider.id}
                        size={16}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex items-baseline gap-2">
                        <p className="text-body-sm font-medium text-foreground">{provider.label}</p>
                        {keyState.configured ? (
                          <p className="text-label-sm text-muted-foreground/60">
                            ···{keyState.suffix}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {isDraft ? (
                      <input
                        ref={(el) => {
                          inputRefs.current[provider.id] = el;
                        }}
                        type="password"
                        value={draft}
                        onChange={(event) =>
                          setApiKeys((current) => ({
                            ...current,
                            [provider.id]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          const trimmed = draft.trim();
                          if (trimmed) void commitProviderKey(provider.id, trimmed);
                          else dismissDraft(provider.id);
                        }}
                        placeholder="API key"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={saving}
                        className="h-8 rounded-lg border border-foreground/8 bg-popover px-3 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:opacity-50"
                      />
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-2 justify-self-end">
                      {saving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                      <PillButton
                        type="button"
                        size="compact"
                        variant="icon"
                        label={`Remove ${provider.label} key`}
                        aria-label={`Remove ${provider.label} key`}
                        onClick={() => {
                          if (isDraft) dismissDraft(provider.id);
                          else void commitProviderKey(provider.id, null);
                        }}
                        disabled={saving}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </PillButton>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {(() => {
          const autoMode = !visibleProviders.some(
            (p) => loadedSettings.providerKeys[p.id].configured,
          );
          return (
            <div
              className={
                "px-4 py-3 flex items-center justify-between gap-3" +
                (autoMode ? "" : " border-b border-foreground/6")
              }
            >
              <h3 className="mb-0! text-sm font-medium text-foreground">Model routing</h3>
              {autoMode ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-label-sm text-muted-foreground"
                  title="Glass automatically picks the best model for every task. Add a provider key to override."
                >
                  <LogoIcon size={12} static className="text-muted-foreground" />
                  Auto
                </span>
              ) : null}
            </div>
          );
        })()}
        {!visibleProviders.some((p) => loadedSettings.providerKeys[p.id].configured) ? null : (
        <div className="px-4 divide-y divide-foreground/6">
          {settings.tasks.map((task: TaskConfig) => {
            const availableProviders = configuredProviders(task.isEmbedding);
            const route = settings.routes[task.id] ?? null;
            const saving = savingTask === task.id;
            const locked = availableProviders.length === 0;
            const value = route ? `${route.provider}:${route.model}` : DEFAULT_VALUE;

            function onChange(next: string | null) {
              if (!next || next === DEFAULT_VALUE) {
                void commitRoute(task.id, null);
                return;
              }
              const [provider, ...modelParts] = next.split(":");
              const model = modelParts.join(":");
              void commitRoute(task.id, { provider: provider as ProviderId, model });
            }

            return (
              <div
                key={task.id}
                className="py-2.5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground">{task.label}</p>
                  <p className="text-label-sm text-muted-foreground/60">
                    {task.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-self-end">
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  ) : null}
                  {locked ? (
                    <p className="text-label-sm text-muted-foreground/60">
                      Add a provider key to customize
                    </p>
                  ) : (
                    <Select value={value} onValueChange={onChange} disabled={saving}>
                      <SelectTrigger className="min-w-65">
                        <SelectValue>
                          {route ? (
                            <span className="flex items-center gap-2">
                              <ProviderLogo provider={route.provider} size={14} />
                              <span className="text-body-sm">{route.model}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Default</span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_VALUE}>
                          <span className="text-muted-foreground">Reset to default</span>
                        </SelectItem>
                        <SelectSeparator />
                        {availableProviders.map((provider) => (
                          <SelectGroup key={provider.id}>
                            <SelectLabel className="flex items-center gap-1.5">
                              <ProviderLogo provider={provider.id} size={12} />
                              {provider.label}
                            </SelectLabel>
                            {modelsForProvider(provider.id, task.isEmbedding).map((model) => (
                              <SelectItem
                                key={`${provider.id}:${model}`}
                                value={`${provider.id}:${model}`}
                              >
                                {model}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
