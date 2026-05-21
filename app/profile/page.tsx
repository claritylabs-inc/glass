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
import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { PhoneInput } from "@/components/ui/phone-input";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  useCachedQuery,
} from "@/lib/sync/use-cached-query";

const inputClass =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const labelClass =
  "text-label-sm font-medium text-muted-foreground block mb-1.5";

type ProfileValues = {
  name: string;
  title: string;
  phone: string;
};

type Viewer = FunctionReturnType<typeof api.users.viewer>;

function valuesEqual(a: ProfileValues | null, b: ProfileValues) {
  return a?.name === b.name && a.title === b.title && a.phone === b.phone;
}

export default function ProfilePage() {
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [debouncedPhone, setDebouncedPhone] = useState("");
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
    canSave: hasChanges && !phoneBlocked,
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
    onQueued: () => setPersistedValues(currentValues),
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to save profile";
      toast.error(
        message.includes("This phone number is already used")
          ? "This phone number is already used by another user."
          : message.includes("Enter a valid phone number")
            ? "Enter a valid phone number with country code."
            : message,
      );
    },
  });

  const saving = profileAutoSave.saving;
  const savedAt = profileAutoSave.savedAt;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges || phoneBlocked || saving) return;
    profileAutoSave.saveNow();
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

  const saveStatus = (
    <span className="text-label-sm text-muted-foreground flex items-center gap-1.5">
      {saving ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          Saving
        </>
      ) : savedAt ? (
        "Saved"
      ) : null}
    </span>
  );

  return (
    <AppShell actions={saveStatus}>
      <FadeIn when={true} staggerIndex={1} duration={0.6}>
        <form onSubmit={handleSubmit}>
          <div className="rounded-lg border border-foreground/6 bg-card mb-4">
            <div className="px-5 py-3.5 border-b border-foreground/6">
              <h3 className="!mb-0 text-sm font-medium text-foreground">
                Account
              </h3>
            </div>
            <div className="px-5 py-5 space-y-4">
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
                    className="w-full rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-body-sm text-muted-foreground/60 cursor-not-allowed"
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
                <p className="text-label-sm text-muted-foreground/60 mt-1.5 flex items-center gap-1.5">
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
            </div>
          </div>

          <p className="text-label-sm text-muted-foreground/50 mt-2">
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
        <div className="rounded-lg border border-foreground/6 bg-card mt-4">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">
              Appearance
            </h3>
          </div>
          <div className="px-5 py-5">
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
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
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
          </div>
        </div>
      </FadeIn>
    </AppShell>
  );
}
