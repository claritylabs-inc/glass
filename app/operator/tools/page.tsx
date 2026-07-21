"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  getModelDisplayName,
  ModelProviderLogo,
  ModelRouteLogo,
} from "@/components/model-provider-logo";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import {
  useCachedOperatorCurrent,
  useCachedOperatorGlobalToolSettings,
  useOperatorGlobalToolSettingsCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { OperatorSidebar } from "../operator-sidebar";

type ModelProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "deepseek";
type WebRetrievalProviderId =
  | "parallel"
  | "exa"
  | "openai"
  | "google"
  | "anthropic"
  | "xai";
type Route = { provider: ModelProviderId; model: string };
type WebRetrieval = { primary: WebRetrievalProviderId; route?: Route };
type WebRetrievalProviderConfig = {
  id: WebRetrievalProviderId;
  label: string;
  configured: boolean;
  models: string[];
  defaultRoute: Route | null;
};
const PROVIDER_SELECT_WIDTH_CLASS = "w-full xl:w-44";
const MODEL_SELECT_WIDTH_CLASS = "w-full xl:w-[30rem]";
const WEB_RETRIEVAL_PRIORITY: WebRetrievalProviderId[] = [
  "parallel",
  "exa",
  "openai",
  "google",
  "anthropic",
  "xai",
];

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

function ParallelLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 6h18M2 12h20M3 18h18"
        stroke="currentColor"
        strokeWidth="2.25"
      />
    </svg>
  );
}

function isApiProvider(provider: WebRetrievalProviderId) {
  return provider === "parallel" || provider === "exa";
}

function WebRetrievalLogo({
  provider,
  size = 14,
}: {
  provider: WebRetrievalProviderId;
  size?: number;
}) {
  if (provider === "parallel") return <ParallelLogo size={size} />;
  if (provider === "exa") return <ExaLogo size={size} />;
  return <ModelProviderLogo provider={provider} size={size} />;
}

function providerSortIndex(provider: WebRetrievalProviderId) {
  const index = WEB_RETRIEVAL_PRIORITY.indexOf(provider);
  return index === -1 ? WEB_RETRIEVAL_PRIORITY.length : index;
}

function providerOptions(
  providers: WebRetrievalProviderConfig[],
  selectedProvider: WebRetrievalProviderId,
) {
  return providers
    .filter((provider) => provider.configured || provider.id === selectedProvider)
    .sort(
      (left, right) =>
        providerSortIndex(left.id) - providerSortIndex(right.id),
    );
}

function SearchProviderRow({
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
  const selectedRoute = isApiProvider(webRetrieval.primary)
    ? null
    : (webRetrieval.route ?? selectedProvider?.defaultRoute ?? null);
  const selectedModels = selectedProvider?.models ?? [];

  function commitProvider(primary: WebRetrievalProviderId) {
    if (isApiProvider(primary)) {
      void onCommit({ primary });
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
          <p className="text-base font-medium text-foreground">
            Search and retrieval
          </p>
          <span className="rounded-full bg-muted/55 px-2 py-0.5 text-tag text-muted-foreground">
            {webRetrieval.primary === "parallel" ? "Default" : "Override"}
          </span>
        </div>
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
            {providerOptions(providers, webRetrieval.primary).map((provider) => (
              <SelectItem
                key={provider.id}
                value={provider.id}
                disabled={!provider.configured}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <WebRetrievalLogo provider={provider.id} size={15} />
                  <span className="truncate text-sm">{provider.label}</span>
                  <span className="ml-auto shrink-0 text-label text-muted-foreground/60">
                    {provider.configured ? "Configured" : "Unavailable"}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRoute ? (
          <Select
            value={selectedRoute.model}
            onValueChange={(model) => {
              if (!model) return;
              void onCommit({
                primary: webRetrieval.primary,
                route: {
                  provider: selectedRoute.provider,
                  model,
                },
              });
            }}
            disabled={saving}
          >
            <SelectTrigger className={MODEL_SELECT_WIDTH_CLASS}>
              <SelectValue>
                <span className="flex min-w-0 items-center gap-2">
                  <ModelRouteLogo route={selectedRoute} size={16} />
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
              {selectedModels.map((model) => {
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
        ) : null}
      </div>
    </div>
  );
}

export default function OperatorToolsPage() {
  const current = useCachedOperatorCurrent();
  const settings = useCachedOperatorGlobalToolSettings();
  const updateWebRetrieval = useMutation(
    api.modelSettings.updateGlobalWebRetrieval,
  );
  const { patchWebRetrieval } =
    useOperatorGlobalToolSettingsCacheActions();
  const [saving, setSaving] = useState(false);

  async function commitWebRetrieval(next: WebRetrieval) {
    setSaving(true);
    try {
      await updateWebRetrieval({ webRetrieval: next });
      await patchWebRetrieval(next);
      toast.success("Search provider updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update search provider",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      breadcrumbDetail="Tools"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="tools"
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
          <OperationalPanel>
            <OperationalPanelHeader title="Web" />
            <div className="divide-y divide-foreground/6 px-4">
              <SearchProviderRow
                webRetrieval={settings.webRetrieval}
                providers={settings.webRetrievalProviders}
                saving={saving}
                onCommit={commitWebRetrieval}
              />
            </div>
          </OperationalPanel>
        )}
      </main>
    </AppShell>
  );
}
