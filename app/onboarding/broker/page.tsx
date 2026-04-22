"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

const DARK_PRESETS = [
  "#1E293B", // slate
  "#1E3A5F", // deep navy
  "#2C5282", // muted blue
  "#2B6B6B", // teal
  "#3F6B4B", // forest
  "#7A5A3A", // warm taupe
  "#8B3A3A", // rust
  "#5B4A7B", // muted violet
] as const;

const PALE_PRESETS = [
  "#E2E8F0", // slate pale
  "#DBE5F1", // navy pale
  "#D6E4F5", // blue pale
  "#D4EAE7", // teal pale
  "#DEEBDF", // forest pale
  "#EFE6D7", // taupe pale
  "#F1D9D6", // rust pale
  "#E4DDEB", // violet pale
] as const;

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
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

function readableTextFor(accent: string): "light" | "dark" {
  return relativeLuminance(accent) > 0.45 ? "dark" : "light";
}

function extractDomain(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

function desaturate(r: number, g: number, b: number, factor = 0.35): [number, number, number] {
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
        const buckets = new Map<string, { r: number; g: number; b: number; count: number; sat: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const light = (max + min) / 2 / 255;
          if (sat < 0.15 || light < 0.12 || light > 0.92) continue;
          const key = `${Math.round(r / 40)}-${Math.round(g / 40)}-${Math.round(b / 40)}`;
          const existing = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, sat: 0 };
          existing.r += r; existing.g += g; existing.b += b;
          existing.count += 1; existing.sat = Math.max(existing.sat, sat);
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
            .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
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
  { label: "Set up your brokerage", subtitle: "Tell us about your firm." },
  { label: "Claim your workspace link", subtitle: "Pick the web address your clients will use to reach you." },
  { label: "Brand your agent", subtitle: "Choose how your AI agent shows up to clients." },
  { label: "Set up your email handle", subtitle: "Optional — your clients can email this to reach your agent. You can set this up later." },
] as const;

function StepDots({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, index) => (
        <div
          key={step.label}
          className={`rounded-full transition-all ${
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-muted-foreground">
          <div className="justify-self-start min-w-0">
            <div className="sm:hidden">
              <LogoIcon size={18} color="#A0D2FA" static />
            </div>
            <div className="hidden sm:block">
              <BrandWordmark />
            </div>
          </div>
          <div className="justify-self-center">
            {typeof currentStep === "number" ? <StepDots currentStep={currentStep} /> : null}
          </div>
          <div className="justify-self-end text-right text-sm text-muted-foreground min-w-0">
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
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const labelClass = "text-label-sm font-medium text-muted-foreground block mb-1.5";

export default function BrokerOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const createBrokerOrg = useMutation(api.orgs.createBrokerOrg);
  const updateProfile = useMutation(api.users.updateProfile);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const claimAgentHandle = useMutation(api.orgs.claimAgentHandle);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const { setOnboardingComplete, clearCache: clearOnboardingCache } = useOnboardingCache();

  const stepParam = searchParams?.get("step");
  const parsedStep = stepParam ? Number(stepParam) : NaN;
  const initialStep: Step =
    Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep <= 3
      ? (parsedStep as Step)
      : 0;

  const [currentStep, setCurrentStepState] = useState<Step>(initialStep);

  const setCurrentStep = useCallback(
    (next: Step) => {
      setCurrentStepState(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("step", String(next));
      router.replace(`/onboarding/broker?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (stepParam == null) return;
    if (Number.isFinite(parsedStep) && parsedStep !== currentStep) {
      setCurrentStepState(parsedStep as Step);
    }
  }, [stepParam, parsedStep, currentStep]);
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [debouncedSlug, setDebouncedSlug] = useState("");
  const [brandingColor, setBrandingColor] = useState("#1E293B");
  const [brandingMode, setBrandingMode] = useState<"light" | "dark">("light");
  const [brandingTextOnAccent, setBrandingTextOnAccent] = useState<"light" | "dark" | "auto">("auto");
  const [sampledColors, setSampledColors] = useState<string[]>([]);
  const [samplingColor, setSamplingColor] = useState(false);
  const [agentDisplayName, setAgentDisplayName] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    setOrgName((v) => v || viewer.companyName || "");
    setWebsite((v) => v || viewer.companyWebsite || "");
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    if (!org) return;
    setOrgName((v) => v || org.name || "");
    setWebsite((v) => v || org.website || "");
    setSlugInput((v) => v || org.slug || "");
    if (org.brandingColor) setBrandingColor(org.brandingColor);
    if (org.brandingMode) setBrandingMode(org.brandingMode);
    if (org.brandingTextOnAccent) setBrandingTextOnAccent(org.brandingTextOnAccent);
    setAgentDisplayName((v) => v || org.agentDisplayName || "");
    setAgentHandle((v) => v || org.agentHandle || "");
  }, [viewerOrg]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSlug(slugInput), 300);
    return () => clearTimeout(timer);
  }, [slugInput]);

  useEffect(() => {
    const domain = extractDomain(website);
    if (!domain) {
      setSampledColors([]);
      return;
    }
    let cancelled = false;
    setSamplingColor(true);
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
    sampleBrandColors(iconUrl).then((colors) => {
      if (cancelled) return;
      setSampledColors(colors);
      setSamplingColor(false);
      if (colors[0] && !viewerOrg?.org?.brandingColor) {
        setBrandingColor(colors[0]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [website, viewerOrg]);

  const slugCheck = useQuery(
    api.orgs.checkSlugAvailability,
    debouncedSlug.length >= 3 ? { slug: debouncedSlug } : "skip",
  );
  const slugChecking = slugInput.length >= 3 && (slugInput !== debouncedSlug || slugCheck === undefined);

  async function handleLogout() {
    clearOnboardingCache();
    await signOut();
    router.replace("/login");
  }

  async function handleNameNext() {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({
        companyName: orgName.trim(),
        companyWebsite: website.trim(),
      });
      if (viewerOrg?.org) {
        await updateOrg({
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
        await createBrokerOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
          slug: slugInput.trim(),
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
      await updateOrg({
        brandingColor: brandingColor || undefined,
        brandingMode,
        brandingTextOnAccent,
        agentDisplayName: agentDisplayName.trim() || undefined,
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
      }
      await completeOnboarding();
      setOnboardingComplete(true);
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to finish");
      setSubmitting(false);
    }
  }

  const canContinueName = orgName.trim().length > 0;
  const canContinueSlug =
    debouncedSlug.length >= 3 && slugInput === debouncedSlug && slugCheck?.available === true;

  return (
    <Shell currentStep={currentStep} email={viewer?.email} onLogout={handleLogout}>
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-left">
          <h1 className="text-base font-medium tracking-tight">{STEPS[currentStep].label}</h1>
          {STEPS[currentStep].subtitle ? (
            <p className="text-base text-muted-foreground">{STEPS[currentStep].subtitle}</p>
          ) : null}
        </div>

        {currentStep === 0 && (
          <div className="space-y-10">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Brokerage name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Insurance Brokers"
                  autoFocus
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

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleNameNext}
              disabled={!canContinueName || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-10">
            <div className="space-y-2">
              <label className={labelClass}>Workspace link</label>
              <div className="flex items-stretch gap-0">
                <div className="flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-label-sm text-muted-foreground/60 select-none whitespace-nowrap">
                  {WORKSPACE_DOMAIN}/
                </div>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) =>
                    setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="acme-brokers"
                  autoFocus
                  className="flex-1 min-w-0 rounded-r-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 min-h-[20px] pt-1">
                {slugChecking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-label-sm text-muted-foreground">Checking...</span>
                  </>
                ) : null}
                {!slugChecking && debouncedSlug.length >= 3 && slugCheck?.available ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-body-sm text-emerald-600">
                      {WORKSPACE_DOMAIN}/{debouncedSlug} is available
                    </span>
                  </>
                ) : null}
                {!slugChecking && debouncedSlug.length >= 3 && slugCheck && !slugCheck.available ? (
                  <>
                    <X className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-body-sm text-red-500">
                      {slugCheck.reason ?? "Not available"}
                    </span>
                  </>
                ) : null}
                {slugInput.length > 0 && slugInput.length < 3 ? (
                  <span className="text-body-sm text-muted-foreground/50">
                    Minimum 3 characters
                  </span>
                ) : null}
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleSlugNext}
              disabled={(!viewerOrg?.org && !canContinueSlug) || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-10">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Agent display name</label>
                <input
                  type="text"
                  value={agentDisplayName}
                  onChange={(e) => setAgentDisplayName(e.target.value)}
                  placeholder="Acme Agent"
                  autoFocus
                  className={inputClass}
                />
              </div>
              {(() => {
                const effectiveText =
                  brandingTextOnAccent === "auto" ? readableTextFor(brandingColor) : brandingTextOnAccent;
                const textColor = effectiveText === "light" ? "#FFFFFF" : "#0F172A";
                const previewBg = brandingMode === "dark" ? "#0B1220" : "#F7F5EF";
                const previewFg = brandingMode === "dark" ? "#E5E7EB" : "#0F172A";
                const previewMuted = brandingMode === "dark" ? "#94A3B8" : "#64748B";
                const previewSurface = brandingMode === "dark" ? "#111827" : "#FFFFFF";
                const previewBorder = brandingMode === "dark" ? "#1F2937" : "#E5E7EB";
                const previewDomain = extractDomain(website);
                const faviconUrl = previewDomain
                  ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(previewDomain)}&sz=64`
                  : null;

                return (
                  <div className="rounded-xl border border-foreground/8 bg-popover/60 p-5 space-y-5">
                    <div className="space-y-1">
                      <label className={labelClass}>White-label branding</label>
                      <p className="text-label-sm text-muted-foreground/80">
                        How your workspace will look to clients. Fine-tune theme, text contrast, and
                        add a custom color from Settings after onboarding.
                      </p>
                    </div>

                    <div
                      className="rounded-lg border p-4 transition-colors"
                      style={{ backgroundColor: previewBg, borderColor: previewBorder }}
                    >
                      <div
                        className="rounded-md p-3 flex items-center gap-3"
                        style={{ backgroundColor: previewSurface, border: `1px solid ${previewBorder}` }}
                      >
                        <div
                          className="h-8 w-8 rounded-md shrink-0 overflow-hidden flex items-center justify-center"
                          style={{ backgroundColor: faviconUrl ? "#FFFFFF" : brandingColor }}
                        >
                          {faviconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={faviconUrl}
                              alt=""
                              className="h-full w-full object-contain"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate" style={{ color: previewFg }}>
                            {agentDisplayName.trim() || orgName.trim() || "Your brokerage"}
                          </div>
                          <div className="text-xs truncate" style={{ color: previewMuted }}>
                            Preview of your client workspace
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                          style={{ backgroundColor: brandingColor, color: textColor }}
                        >
                          Continue
                        </button>
                      </div>
                    </div>

                    {sampledColors.length > 0 || samplingColor ? (
                      <div className="space-y-2">
                        <p className="text-label-sm text-muted-foreground">From your website</p>
                        {samplingColor ? (
                          <div className="flex items-center gap-2 text-label-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Pulling colors from {extractDomain(website)}…
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {sampledColors.map((color) => {
                              const selected = brandingColor.toLowerCase() === color.toLowerCase();
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => setBrandingColor(color)}
                                  className={`flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 text-label-sm transition-colors ${
                                    selected
                                      ? "border-foreground/30 bg-foreground/[0.04] text-foreground"
                                      : "border-foreground/10 bg-popover text-muted-foreground hover:border-foreground/20"
                                  }`}
                                >
                                  <span
                                    className="h-5 w-5 rounded-full border border-foreground/10"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="font-mono uppercase tracking-wider text-[11px]">
                                    {color}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {(() => {
                      const renderRow = (
                        colors: ReadonlyArray<string>,
                        textMode: "light" | "dark",
                        heading: string,
                      ) => (
                        <div className="space-y-2">
                          <p className="text-label-sm text-muted-foreground">{heading}</p>
                          <div className="grid grid-cols-8 gap-2">
                            {colors.map((color) => {
                              const selected = brandingColor.toLowerCase() === color.toLowerCase();
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => {
                                    setBrandingColor(color);
                                    setBrandingTextOnAccent(textMode);
                                  }}
                                  aria-label={`Select ${color}`}
                                  className={`relative aspect-square rounded-md border border-foreground/5 ring-offset-2 ring-offset-background transition-all ${
                                    selected ? "ring-2 ring-foreground" : "hover:scale-105"
                                  }`}
                                  style={{ backgroundColor: color }}
                                >
                                  {selected ? (
                                    <Check
                                      className="absolute inset-0 m-auto h-3.5 w-3.5 drop-shadow"
                                      style={{ color: textMode === "light" ? "#FFFFFF" : "#0F172A" }}
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                      return (
                        <div className="space-y-4">
                          {renderRow(DARK_PRESETS, "light", "Deep — pairs with light text")}
                          {renderRow(PALE_PRESETS, "dark", "Pale — pairs with dark text")}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleBrandingNext}
              disabled={submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-10">
            <div className="space-y-2">
              <label className={labelClass}>Agent handle (optional)</label>
              <div className="flex items-stretch gap-0">
                <input
                  type="text"
                  value={agentHandle}
                  onChange={(e) =>
                    setAgentHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30))
                  }
                  placeholder="acme"
                  autoFocus
                  className="flex-1 min-w-0 rounded-l-lg border border-r-0 border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
                <div className="flex items-center rounded-r-lg border border-l-0 border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-label-sm text-muted-foreground/60 select-none whitespace-nowrap">
                  @{WORKSPACE_DOMAIN}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Clients will email this address to reach your AI agent.
              </p>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {submitting ? "Finishing…" : "Finish setup"}
            </PillButton>
          </div>
        )}
      </div>
    </Shell>
  );
}
