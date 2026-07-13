"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AccentColorPicker } from "@/components/ui/accent-color-picker";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedViewerOrg,
  useViewerCacheActions,
} from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

const WORKSPACE_DOMAIN = getPublicAgentDomain();

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(n)) return null;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const linearize = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

function readableTextFor(accent: string): "light" | "dark" {
  return relativeLuminance(accent) > 0.45 ? "dark" : "light";
}

function extractDomain(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

function desaturate(
  r: number,
  g: number,
  b: number,
  factor = 0.35,
): [number, number, number] {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    Math.round(r + (gray - r) * factor),
    Math.round(g + (gray - g) * factor),
    Math.round(b + (gray - b) * factor),
  ];
}

async function sampleBrandColors(imgUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    // CORS-taint failures (e.g. Google favicon service has no CORS) silently
    // resolve with an empty palette instead of logging to the console.
    img.onerror = () => resolve([]);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 48;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const buckets = new Map<
          string,
          { r: number; g: number; b: number; count: number; sat: number }
        >();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2],
            a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b),
            min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const light = (max + min) / 2 / 255;
          if (sat < 0.15 || light < 0.12 || light > 0.92) continue;
          const key = `${Math.round(r / 40)}-${Math.round(g / 40)}-${Math.round(b / 40)}`;
          const existing = buckets.get(key) ?? {
            r: 0,
            g: 0,
            b: 0,
            count: 0,
            sat: 0,
          };
          existing.r += r;
          existing.g += g;
          existing.b += b;
          existing.count += 1;
          existing.sat = Math.max(existing.sat, sat);
          buckets.set(key, existing);
        }
        if (buckets.size === 0) return resolve([]);
        const ranked = Array.from(buckets.values())
          .sort((a, b) => b.count * (0.4 + b.sat) - a.count * (0.4 + a.sat))
          .slice(0, 5);
        const colors: string[] = [];
        for (const b of ranked) {
          const [dr, dg, db] = desaturate(
            Math.round(b.r / b.count),
            Math.round(b.g / b.count),
            Math.round(b.b / b.count),
            0.3,
          );
          const hex = `#${[dr, dg, db]
            .map((v) =>
              Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"),
            )
            .join("")
            .toUpperCase()}`;
          if (!colors.some((c) => c === hex)) colors.push(hex);
          if (colors.length >= 3) break;
        }
        resolve(colors);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = imgUrl;
  });
}

type Step = 0 | 1 | 2 | 3;

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Set up your organization", subtitle: "Tell us about your firm." },
  {
    label: "Claim your workspace link",
    subtitle: "Pick the web address your clients will use to reach you.",
  },
  {
    label: "Brand your agent",
    subtitle: "Choose how your AI agent shows up to clients.",
  },
  {
    label: "Set up your email handle",
    subtitle:
      "Optional — your clients can email this to reach your agent. You can set this up later.",
  },
] as const;

function StepDots({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, index) => (
        <div
          key={step.label}
          className={`rounded-full transition-colors duration-100 ${
            index === currentStep
              ? "h-1.5 w-6 bg-foreground sm:h-1.5 sm:w-7"
              : "h-1.5 w-1.5 bg-foreground/15 sm:h-1.5 sm:w-1.5"
          }`}
        />
      ))}
    </div>
  );
}

function Shell({
  children,
  currentStep,
  email,
  onLogout,
}: {
  children: ReactNode;
  currentStep?: Step;
  email?: string;
  onLogout?: () => Promise<void> | void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-base text-muted-foreground">
          <div className="justify-self-start min-w-0">
            <div className="sm:hidden">
              <LogoIcon size={18} color="#A0D2FA" static />
            </div>
            <div className="hidden sm:block">
              <BrandWordmark />
            </div>
          </div>
          <div className="justify-self-center">
            {typeof currentStep === "number" ? (
              <StepDots currentStep={currentStep} />
            ) : null}
          </div>
          <div className="justify-self-end text-right text-base text-muted-foreground min-w-0">
            {email ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline">{email}</span>
                {onLogout ? (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="font-medium text-foreground transition hover:opacity-70"
                  >
                    Log out
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        {children}
      </main>
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const labelClass =
  "text-label font-medium text-muted-foreground block mb-1.5";

export default function BrokerOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signOut } = useAuthActions();
  const viewer = useCachedQuery("onboarding.broker.viewer", api.users.viewer, {});
  const viewerOrg = useCachedViewerOrg();
  const { patchViewer, patchViewerOrg, setViewerOrg } = useViewerCacheActions();
  const createBrokerOrg = useMutation(api.orgs.createBrokerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const updateBrokerBranding = useMutation(
    api.organizations.updateBrokerBranding,
  );
  const claimAgentHandle = useMutation(api.orgs.claimAgentHandle);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const updateProfile = useMutation(api.users.updateProfile);
  const { setOnboardingComplete, clearCache: clearOnboardingCache } =
    useOnboardingCache();

  const stepParam = searchParams?.get("step");
  const parsedStep = stepParam ? Number(stepParam) : NaN;
  const initialStep: Step =
    Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep <= 3
      ? (parsedStep as Step)
      : 0;

  const currentStep = initialStep;

  const setCurrentStep = useCallback(
    (next: Step) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("step", String(next));
      router.replace(`/onboarding/broker?${params.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  // A user already belonging to a non-broker org can't run this wizard — the
  // broker-org creation step would be skipped and they'd finish onboarding
  // still attached to their client org. Bounce them home.
  useEffect(() => {
    if (!viewerOrg?.org) return;
    const type = (viewerOrg.org as { type?: "broker" | "client" }).type;
    if (type && type !== "broker") {
      router.replace("/");
    }
  }, [viewerOrg, router]);
  const [userNameInput, setUserName] = useState<string | null>(null);
  const [userTitleInput, setUserTitle] = useState<string | null>(null);
  const [orgNameInput, setOrgName] = useState<string | null>(null);
  const [websiteInput, setWebsite] = useState<string | null>(null);
  const [slugInputOverride, setSlugInput] = useState<string | null>(null);
  const [debouncedSlug, setDebouncedSlug] = useState("");
  const [brandingColorOverride, setBrandingColor] = useState<string | null>(
    null,
  );
  const [brandingTextOnAccentOverride, setBrandingTextOnAccent] = useState<
    "light" | "dark" | "auto" | null
  >(null);
  const [sampleResult, setSampleResult] = useState<{
    domain: string;
    colors: string[];
  } | null>(null);
  const [agentHandleOverride, setAgentHandle] = useState<string | null>(null);
  const [debouncedHandle, setDebouncedHandle] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const userName = userNameInput ?? viewer?.name ?? "";
  const userTitle = userTitleInput ?? viewer?.title ?? "";
  const orgName = orgNameInput ?? viewerOrg?.org?.name ?? "";
  const website = websiteInput ?? viewerOrg?.org?.website ?? "";
  const slugInput = slugInputOverride ?? viewerOrg?.org?.slug ?? "";
  const agentHandle = agentHandleOverride ?? viewerOrg?.org?.agentHandle ?? "";
  const samplingDomain = extractDomain(website);
  const sampledColors =
    sampleResult?.domain === samplingDomain ? sampleResult.colors : [];
  const brandingColor =
    brandingColorOverride ??
    viewerOrg?.org?.brandingColor ??
    sampledColors[0] ??
    "#1E293B";
  const brandingTextOnAccent =
    brandingTextOnAccentOverride ??
    viewerOrg?.org?.brandingTextOnAccent ??
    "auto";

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSlug(slugInput), 300);
    return () => clearTimeout(timer);
  }, [slugInput]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHandle(agentHandle), 300);
    return () => clearTimeout(timer);
  }, [agentHandle]);

  useEffect(() => {
    if (!samplingDomain) return;
    let cancelled = false;
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(samplingDomain)}&sz=128`;
    sampleBrandColors(iconUrl).then((colors) => {
      if (cancelled) return;
      setSampleResult({ domain: samplingDomain, colors });
    });
    return () => {
      cancelled = true;
    };
  }, [samplingDomain]);

  const slugCheck = useQuery(
    api.orgs.checkSlugAvailability,
    debouncedSlug.length >= 3 ? { slug: debouncedSlug } : "skip",
  );
  const slugChecking =
    slugInput.length >= 3 &&
    (slugInput !== debouncedSlug || slugCheck === undefined);

  const handleCheck = useQuery(
    api.orgs.checkHandleAvailability,
    debouncedHandle.length >= 3 &&
      debouncedHandle !== viewerOrg?.org?.agentHandle
      ? { handle: debouncedHandle }
      : "skip",
  );
  const handleChecking =
    agentHandle.length >= 3 &&
    agentHandle !== viewerOrg?.org?.agentHandle &&
    (agentHandle !== debouncedHandle || handleCheck === undefined);

  async function handleLogout() {
    clearOnboardingCache();
    await signOut();
    router.replace("/login");
  }

  async function handleNameNext() {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({ name: userName.trim(), title: userTitle.trim() });
      patchViewer({ name: userName.trim(), title: userTitle.trim() });
      if (viewerOrg?.org) {
        await updateOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
        });
        patchViewerOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
        });
      }
      setCurrentStep(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSlugNext() {
    setSubmitting(true);
    setError("");
    try {
      if (!viewerOrg?.org) {
        const orgId = await createBrokerOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
          slug: slugInput.trim(),
        });
        const now = dayjs().valueOf();
        setViewerOrg({
          org: {
            _id: orgId,
            _creationTime: now,
            name: orgName.trim(),
            website: website.trim() || undefined,
            slug: slugInput.trim(),
            type: "broker",
            iconUrl: null,
          },
          membership: {
            _id: `local:${orgId}:membership` as never,
            _creationTime: now,
            orgId,
            userId: viewer?._id as never,
            role: "admin",
          },
          brokerOrg: null,
        });
      }
      setCurrentStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBrandingNext() {
    setSubmitting(true);
    setError("");
    try {
      if (!viewerOrg?.org?._id) throw new Error("Organization not ready");
      await updateBrokerBranding({
        brokerOrgId: viewerOrg.org._id,
        brandingColor: brandingColor || undefined,
        brandingTextOnAccent,
      });
      patchViewerOrg({
        brandingColor: brandingColor || undefined,
        brandingTextOnAccent,
      });
      setCurrentStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    setSubmitting(true);
    setError("");
    try {
      const handle = agentHandle.trim();
      if (handle && !viewerOrg?.org?.agentHandle) {
        await claimAgentHandle({ handle });
        patchViewerOrg({ agentHandle: handle });
      }
      await completeOnboarding();
      patchViewer({ onboardingComplete: true });
      patchViewerOrg({ onboardingComplete: true });
      setOnboardingComplete(true);
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to finish");
      setSubmitting(false);
    }
  }

  const canContinueName =
    orgName.trim().length > 0 &&
    userName.trim().length > 0 &&
    userTitle.trim().length > 0;
  const canContinueSlug =
    debouncedSlug.length >= 3 &&
    slugInput === debouncedSlug &&
    slugCheck?.available === true;

  return (
    <Shell
      currentStep={currentStep}
      email={viewer?.email}
      onLogout={handleLogout}
    >
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-left">
          <h1 className="text-base font-medium tracking-tight">
            {STEPS[currentStep].label}
          </h1>
          {STEPS[currentStep].subtitle ? (
            <p className="text-base text-muted-foreground">
              {STEPS[currentStep].subtitle}
            </p>
          ) : null}
        </div>

        {currentStep === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinueName || submitting) return;
              void handleNameNext();
            }}
            className="space-y-10"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className={labelClass}>Your name</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Jane Smith"
                    autoFocus
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Your role</label>
                  <input
                    type="text"
                    value={userTitle}
                    onChange={(e) => setUserTitle(e.target.value)}
                    placeholder="Producer"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Organization name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Insurance Brokers"
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Website (optional)</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acme-brokers.com"
                  className={inputClass}
                />
              </div>
            </div>

            {error ? (
              <p className="text-base text-muted-foreground">{error}</p>
            ) : null}

            <PillButton
              type="submit"
              disabled={!canContinueName || submitting}
              className="w-full justify-center text-base shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if ((!viewerOrg?.org && !canContinueSlug) || submitting) return;
              void handleSlugNext();
            }}
            className="space-y-10"
          >
            <div className="space-y-2">
              <label className={labelClass}>Workspace link</label>
              <div className="flex items-stretch gap-0">
                <div className="flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/2 px-3 py-2 text-label text-muted-foreground/60 select-none whitespace-nowrap">
                  {WORKSPACE_DOMAIN}/
                </div>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) =>
                    setSlugInput(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    )
                  }
                  placeholder="acme-brokers"
                  autoFocus
                  className="h-9 flex-1 min-w-0 rounded-r-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 min-h-5 pt-1">
                {slugChecking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-label text-muted-foreground">
                      Checking...
                    </span>
                  </>
                ) : null}
                {!slugChecking &&
                debouncedSlug.length >= 3 &&
                slugCheck?.available ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-base text-emerald-600">
                      {WORKSPACE_DOMAIN}/{debouncedSlug} is available
                    </span>
                  </>
                ) : null}
                {!slugChecking &&
                debouncedSlug.length >= 3 &&
                slugCheck &&
                !slugCheck.available ? (
                  <>
                    <X className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-base text-red-500">
                      {slugCheck.reason ?? "Not available"}
                    </span>
                  </>
                ) : null}
                {slugInput.length > 0 && slugInput.length < 3 ? (
                  <span className="text-base text-muted-foreground/50">
                    Minimum 3 characters
                  </span>
                ) : null}
              </div>
            </div>

            {error ? (
              <p className="text-base text-muted-foreground">{error}</p>
            ) : null}

            <PillButton
              type="submit"
              disabled={(!viewerOrg?.org && !canContinueSlug) || submitting}
              className="w-full justify-center text-base shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 2 && (
          <div className="space-y-10">
            <div className="space-y-6">
              {(() => {
                const textColor =
                  readableTextFor(brandingColor) === "light"
                    ? "#FFFFFF"
                    : "#0F172A";
                const previewDomain = extractDomain(website);
                const faviconUrl = previewDomain
                  ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(previewDomain)}&sz=64`
                  : null;

                return (
                  <>
                    <div className="space-y-2">
                      <label className={labelClass}>Accent color</label>
                      <AccentColorPicker
                        value={brandingColor}
                        onChange={(c) => {
                          setBrandingColor(c);
                          setBrandingTextOnAccent("auto");
                        }}
                        website={website}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className={labelClass}>Preview</label>
                      <div className="rounded-md p-3 flex items-center gap-3 border border-foreground/8 bg-card">
                        <div
                          className="h-8 w-8 rounded-md shrink-0 overflow-hidden flex items-center justify-center"
                          style={{
                            backgroundColor: faviconUrl
                              ? "#FFFFFF"
                              : brandingColor,
                          }}
                        >
                          {faviconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={faviconUrl}
                              alt=""
                              className="h-full w-full object-contain"
                              onError={(e) => {
                                (
                                  e.currentTarget as HTMLImageElement
                                ).style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-medium truncate text-foreground">
                            {orgName.trim() || "Your organization"}
                          </div>
                          <div className="text-label truncate text-muted-foreground">
                            Preview of your client workspace
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="rounded-full px-3.5 py-1.5 text-label font-medium"
                          style={{
                            backgroundColor: brandingColor,
                            color: textColor,
                          }}
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {error ? (
              <p className="text-base text-muted-foreground">{error}</p>
            ) : null}

            <PillButton
              type="button"
              onClick={handleBrandingNext}
              disabled={submitting}
              className="w-full justify-center text-base shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 3 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const handleInvalid =
                (agentHandle.length > 0 && agentHandle.length < 3) ||
                (agentHandle.length >= 3 &&
                  agentHandle !== viewerOrg?.org?.agentHandle &&
                  (handleChecking || !handleCheck?.available));
              if (submitting || handleInvalid) return;
              void handleFinish();
            }}
            className="space-y-10"
          >
            <div className="space-y-2">
              <label className={labelClass}>Agent handle (optional)</label>
              <div className="flex items-stretch gap-0">
                <input
                  type="text"
                  value={agentHandle}
                  onChange={(e) =>
                    setAgentHandle(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, "")
                        .slice(0, 30),
                    )
                  }
                  placeholder="acme"
                  autoFocus
                  className="h-9 flex-1 min-w-0 rounded-l-lg border border-r-0 border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
                <div className="flex items-center rounded-r-lg border border-l-0 border-foreground/8 bg-foreground/2 px-3 py-2 text-label text-muted-foreground/60 select-none whitespace-nowrap">
                  @{WORKSPACE_DOMAIN}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 min-h-5">
                {handleChecking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-label text-muted-foreground">
                      Checking…
                    </span>
                  </>
                ) : null}
                {!handleChecking &&
                debouncedHandle.length >= 3 &&
                debouncedHandle !== viewerOrg?.org?.agentHandle &&
                handleCheck?.available ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-base text-emerald-600">
                      {debouncedHandle}@{WORKSPACE_DOMAIN} is available
                    </span>
                  </>
                ) : null}
                {!handleChecking &&
                debouncedHandle.length >= 3 &&
                debouncedHandle !== viewerOrg?.org?.agentHandle &&
                handleCheck &&
                !handleCheck.available ? (
                  <>
                    <X className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-base text-red-500">
                      {handleCheck.reason ?? "Not available"}
                    </span>
                  </>
                ) : null}
                {agentHandle.length > 0 && agentHandle.length < 3 ? (
                  <span className="text-base text-muted-foreground/50">
                    Minimum 3 characters
                  </span>
                ) : null}
                {agentHandle.length === 0 ? (
                  <span className="text-label text-muted-foreground">
                    Clients will email this address to reach your AI agent.
                  </span>
                ) : null}
              </div>
            </div>

            {error ? (
              <p className="text-base text-muted-foreground">{error}</p>
            ) : null}

            <PillButton
              type="submit"
              disabled={
                submitting ||
                (agentHandle.length > 0 && agentHandle.length < 3) ||
                (agentHandle.length >= 3 &&
                  agentHandle !== viewerOrg?.org?.agentHandle &&
                  (handleChecking || !handleCheck?.available))
              }
              className="w-full justify-center text-base shadow-none sm:w-auto"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {submitting ? "Finishing…" : "Finish setup"}
            </PillButton>
          </form>
        )}
      </div>
    </Shell>
  );
}
