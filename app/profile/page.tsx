"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { Loader2, Sun, Moon, Monitor } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { useTheme } from "@/hooks/use-theme";

export default function ProfilePage() {
  const viewer = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);

  const { theme, setTheme } = useTheme();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      setTitle((viewer as Record<string, unknown>).title as string ?? "");
    }
  }, [viewer]);

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        name: name || undefined,
        ...(title ? { title } : {}),
      });
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
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

  const saveButton = (
    <PillButton size="compact" onClick={handleSave} disabled={saving}>
      {saving ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Saving...
        </>
      ) : (
        "Save Profile"
      )}
    </PillButton>
  );

  return (
    <AppShell actions={saveButton}>

          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <form onSubmit={handleSave}>
              <div className="rounded-lg border border-foreground/6 bg-card mb-4">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Account</h3>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                        Email
                      </label>
                      <input
                        type="email"
                        value={viewer?.email ?? ""}
                        disabled
                        className="w-full rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-body-sm text-muted-foreground/60 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                        Title
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Risk Manager, CFO"
                        className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={viewer?.phone ?? ""}
                        disabled
                        className="w-full rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-body-sm text-muted-foreground/60 cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-label-sm text-muted-foreground/50 mt-2">
                Company settings, broker info, and team management are in{" "}
                <a href="/settings" className="text-foreground/60 hover:text-foreground underline">
                  Organization Settings
                </a>.
              </p>
            </form>
          </FadeIn>

          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-card mt-4">
              <div className="px-5 py-3.5 border-b border-foreground/6">
                <h3 className="!mb-0 text-sm font-medium text-foreground">Appearance</h3>
              </div>
              <div className="px-5 py-5">
                <div className="flex gap-2">
                  {([
                    { value: "light" as const, label: "Light", icon: Sun },
                    { value: "dark" as const, label: "Dark", icon: Moon },
                    { value: "system" as const, label: "System", icon: Monitor },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-body-sm font-medium transition-colors cursor-pointer ${
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
