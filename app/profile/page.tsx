"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { isValidPhoneNumber } from "react-phone-number-input";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Loader2,
  Mail,
  MessageSquareText,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Label } from "@/components/ui/label";
import { SelfEmailChangeDrawer } from "@/components/settings/change-email-drawer";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useTheme } from "@/hooks/use-theme";
import { PhoneInput } from "@/components/ui/phone-input";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useViewerCacheActions } from "@/lib/sync/glass-cached-queries";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  useCachedQuery,
} from "@/lib/sync/use-cached-query";

const inputClass =
  "h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const labelClass =
  "text-label font-medium text-muted-foreground block mb-1.5";

type ProfileValues = {
  name: string;
  title: string;
  phone: string;
};

type Viewer = FunctionReturnType<typeof api.users.viewer>;
type ProactiveChannelChoice = "email" | "imessage" | "both";
type ProactiveChannelPreferences = {
  email: boolean;
  imessage: boolean;
  configured: boolean;
};

const PROACTIVE_CHANNEL_LABELS: Record<ProactiveChannelChoice, string> = {
  email: "Email",
  imessage: "Text (iMessage)",
  both: "Email and text (iMessage)",
};

function isProactiveChannelChoice(
  value: unknown,
): value is ProactiveChannelChoice {
  return value === "email" || value === "imessage" || value === "both";
}

function proactiveChannelChoice(
  preferences: ProactiveChannelPreferences | undefined,
): ProactiveChannelChoice | null {
  if (!preferences) return null;
  if (preferences.email && preferences.imessage) return "both";
  if (preferences.imessage) return "imessage";
  if (preferences.email) return "email";
  return null;
}

function valuesEqual(a: ProfileValues | null, b: ProfileValues) {
  return a?.name === b.name && a.title === b.title && a.phone === b.phone;
}

export default function ProfilePage() {
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const currentOrg = useCurrentOrg();
  const updateProfile = useMutation(api.users.updateProfile);
  const setProactiveChannels = useMutation(
    api.notificationPreferences.setProactiveChannels,
  );
  const proactivePreferences = useCachedQuery(
    "notificationPreferences.getProactiveChannels",
    api.notificationPreferences.getProactiveChannels,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ProactiveChannelPreferences | undefined;
  const { theme, setTheme } = useTheme();
  const { patchViewer } = useViewerCacheActions();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [debouncedPhone, setDebouncedPhone] = useState("");
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);
  const [proactiveDrawerOpen, setProactiveDrawerOpen] = useState(false);
  const [proactiveDraft, setProactiveDraft] =
    useState<ProactiveChannelChoice>("email");
  const [savingProactiveChannels, setSavingProactiveChannels] = useState(false);
  const [persistedValues, setPersistedValues] = useState<ProfileValues | null>(
    null,
  );

  useEffect(() => {
    if (!viewer || persistedValues) return;
    const initial = {
      name: viewer.name ?? "",
      title: viewer.title ?? "",
      phone: viewer.phone ?? "",
    };
    queueMicrotask(() => {
      setName(initial.name);
      setTitle(initial.title);
      setPhone(initial.phone);
      setDebouncedPhone(initial.phone);
      setPersistedValues(initial);
    });
  }, [persistedValues, viewer]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPhone(phone.trim()), 300);
    return () => clearTimeout(timer);
  }, [phone]);

  const currentPhone = persistedValues?.phone ?? "";
  const trimmedPhone = phone.trim();
  const phoneChanged = trimmedPhone !== currentPhone;
  const phoneHasDigits = /\d/.test(trimmedPhone);
  const phoneValid =
    trimmedPhone.length > 0 && isValidPhoneNumber(trimmedPhone);
  const phoneInvalid =
    phoneHasDigits &&
    !phoneValid &&
    trimmedPhone.replace(/\D/g, "").length >= 7;
  const shouldCheckPhone = phoneChanged && phoneValid;
  const phoneAvailability = useQuery(
    api.users.checkPhoneAvailability,
    shouldCheckPhone && debouncedPhone === trimmedPhone
      ? { phone: debouncedPhone }
      : "skip",
  );
  const phoneChecking =
    shouldCheckPhone &&
    (debouncedPhone !== trimmedPhone || phoneAvailability === undefined);
  const phoneUnavailable =
    shouldCheckPhone && phoneAvailability?.available === false;
  const phoneBlocked = phoneInvalid || phoneChecking || phoneUnavailable;

  const currentValues: ProfileValues = {
    name: name.trim(),
    title: title.trim(),
    phone: trimmedPhone,
  };
  const hasChanges =
    persistedValues !== null && !valuesEqual(persistedValues, currentValues);

  const saveProfile = useCallback(
    async (next: ProfileValues) => {
      await updateProfile({
        name: next.name,
        title: next.title,
        phone: next.phone,
      });
    },
    [updateProfile],
  );

  const profileAutoSave = useLocalFirstAutoSave({
    mutationName: "profile.update",
    args: currentValues,
    valueKey: JSON.stringify(currentValues),
    enabled: persistedValues !== null,
    canSave: !phoneBlocked,
    applyLocal: (store, next) => {
      const collection = cachedQueryCollectionFor<Viewer>("users.viewer");
      const argsKey = cachedQueryArgsKey({});
      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (!current) return;
      void store.upsertCollection(collection, argsKey, [
        {
          _id: "result",
          value: {
            ...current,
            name: next.name,
            title: next.title,
            phone: next.phone,
          },
          updatedAt: dayjs().valueOf(),
        },
      ]);
    },
    flush: saveProfile,
    onFlushed: (_result, next) => setPersistedValues(next),
    errorMessage: (err) => {
      const message = getUserFacingErrorMessage(err, "Failed to save profile");
      return message.includes("This phone number is already used")
        ? "This phone number is already used by another user."
        : message.includes("Enter a valid phone number")
          ? "Enter a valid phone number with country code."
          : message;
    },
  });

  const saving = profileAutoSave.saving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges || phoneBlocked || saving) return;
    void profileAutoSave.saveNow();
  }

  function openProactiveDrawer() {
    const currentChoice = proactiveChannelChoice(proactivePreferences) ?? "email";
    setProactiveDraft(
      !viewer?.phone && currentChoice !== "email" ? "email" : currentChoice,
    );
    setEmailDrawerOpen(false);
    setProactiveDrawerOpen(true);
  }

  async function saveProactiveChannels() {
    if (!currentOrg?.orgId) return;
    const includesImessage =
      proactiveDraft === "imessage" || proactiveDraft === "both";
    if (includesImessage && !viewer?.phone) {
      toast.error("Add a mobile number before choosing iMessage");
      return;
    }
    setSavingProactiveChannels(true);
    try {
      await setProactiveChannels({
        orgId: currentOrg.orgId,
        email: proactiveDraft === "email" || proactiveDraft === "both",
        imessage: includesImessage,
      });
      toast.success("Proactive contact method updated");
      setProactiveDrawerOpen(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Failed to update proactive contact method",
        ),
      );
    } finally {
      setSavingProactiveChannels(false);
    }
  }

  if (viewer === undefined) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const effectiveProactiveChoice = proactiveChannelChoice(proactivePreferences);
  const headerActions = (
    <>
      <AutoSaveStatus status={profileAutoSave.status} />
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => {
          setProactiveDrawerOpen(false);
          setEmailDrawerOpen(true);
        }}
      >
        <Mail className="h-3.5 w-3.5" />
        Change Email
      </PillButton>
    </>
  );

  return (
    <AppShell
      actions={headerActions}
      rightPanel={
        <>
          <SelfEmailChangeDrawer
            open={emailDrawerOpen}
            onOpenChange={setEmailDrawerOpen}
            currentEmail={viewer?.email}
            onConfirmed={(email) => patchViewer({ email })}
          />
          <SettingsDrawer
            open={proactiveDrawerOpen}
            onOpenChange={setProactiveDrawerOpen}
            title="Proactive conversations"
            footer={
              <>
                <PillButton
                  variant="secondary"
                  disabled={savingProactiveChannels}
                  onClick={() => setProactiveDrawerOpen(false)}
                >
                  Cancel
                </PillButton>
                <PillButton
                  disabled={savingProactiveChannels || !currentOrg?.orgId}
                  onClick={() => void saveProactiveChannels()}
                >
                  {savingProactiveChannels ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Save
                </PillButton>
              </>
            }
          >
            <div className="space-y-4">
              <div>
                <Label
                  htmlFor="proactive-contact-method"
                  className="mb-1.5 text-muted-foreground"
                >
                  Preferred contact method
                </Label>
                <Select
                  value={proactiveDraft}
                  onValueChange={(value) => {
                    if (isProactiveChannelChoice(value)) {
                      setProactiveDraft(value);
                    }
                  }}
                >
                  <SelectTrigger
                    id="proactive-contact-method"
                    className="w-full"
                  >
                    <SelectValue>
                      {PROACTIVE_CHANNEL_LABELS[proactiveDraft]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="imessage" disabled={!viewer?.phone}>
                      Text (iMessage)
                    </SelectItem>
                    <SelectItem value="both" disabled={!viewer?.phone}>
                      Email and text (iMessage)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-base text-muted-foreground">
                Glass uses this for proactive mailbox findings and compliance
                conversations. In-app notifications still appear in Glass.
              </p>
              {!viewer?.phone ? (
                <p className="text-base text-muted-foreground">
                  Add a mobile number to use iMessage.
                </p>
              ) : null}
            </div>
          </SettingsDrawer>
        </>
      }
    >
      <FadeIn when={true} staggerIndex={1} duration={0.6}>
        <form onSubmit={handleSubmit}>
          <OperationalPanel className="mb-4">
            <OperationalPanelHeader title="Account" className="px-5 py-3.5" />
            <OperationalPanelBody className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    value={viewer?.email ?? ""}
                    disabled
                    className="h-9 w-full rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 text-base text-muted-foreground/60 cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Risk Manager, CFO"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Mobile number</label>
                <PhoneInput
                  value={phone || undefined}
                  onChange={(value) => setPhone(value ?? "")}
                  defaultCountry="US"
                  placeholder="Enter phone number"
                />
                <p className="text-label text-muted-foreground/60 mt-1.5 flex items-center gap-1.5">
                  {phoneInvalid ? (
                    <span className="text-red-500/80">
                      Enter a valid phone number with country code.
                    </span>
                  ) : phoneChecking ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking phone number
                    </>
                  ) : phoneUnavailable ? (
                    <span className="text-red-500/80">
                      This phone number is already used by another user.
                    </span>
                  ) : shouldCheckPhone && phoneAvailability?.available ? (
                    "Phone number is available"
                  ) : (
                    "Used for iMessage access to your Glass agent."
                  )}
                </p>
              </div>
            </OperationalPanelBody>
          </OperationalPanel>

          <p className="text-label text-muted-foreground/50 mt-2">
            Company settings, broker info, and team management are in{" "}
            <a
              href="/settings"
              className="text-foreground/60 hover:text-foreground underline"
            >
              Organization Settings
            </a>
            .
          </p>
        </form>
      </FadeIn>

      <FadeIn when={true} staggerIndex={2} duration={0.6}>
        <OperationalPanel className="mt-4">
          <OperationalPanelHeader
            title="Proactive conversations"
            className="px-5 py-3.5"
            action={
              <PillButton
                size="compact"
                variant="secondary"
                onClick={openProactiveDrawer}
              >
                Edit
              </PillButton>
            }
          />
          <OperationalPanelBody className="px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground">
                <MessageSquareText className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-medium text-foreground">
                  {proactivePreferences === undefined
                    ? "Loading contact method"
                    : effectiveProactiveChoice
                      ? PROACTIVE_CHANNEL_LABELS[effectiveProactiveChoice]
                      : "In-app only"}
                </p>
                <p className="mt-0.5 text-base text-muted-foreground">
                  Where Glass contacts you when it finds something that needs
                  attention.
                </p>
              </div>
            </div>
          </OperationalPanelBody>
        </OperationalPanel>
      </FadeIn>

      <FadeIn when={true} staggerIndex={3} duration={0.6}>
        <OperationalPanel className="mt-4">
          <OperationalPanelHeader title="Appearance" className="px-5 py-3.5" />
          <OperationalPanelBody className="px-5 py-5">
            <div className="flex gap-2">
              {[
                { value: "light" as const, label: "Light", icon: Sun },
                { value: "dark" as const, label: "Dark", icon: Moon },
                { value: "system" as const, label: "System", icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-base font-medium transition-colors ${
                    theme === value
                      ? "bg-foreground/[0.07] text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </OperationalPanelBody>
        </OperationalPanel>
      </FadeIn>
    </AppShell>
  );
}
