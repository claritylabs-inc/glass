"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";

export default function ProfilePage() {
  const viewer = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      setTitle((viewer as any).title ?? "");
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
      <>
        <Nav />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  const saveButton = (
    <PillButton onClick={handleSave} disabled={saving}>
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
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-12 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="!mb-1">Profile</h1>
                <p className="text-body-sm text-muted-foreground">
                  Your personal account information
                </p>
              </div>
              <div className="hidden md:flex items-center gap-3">
                {saveButton}
              </div>
            </div>
          </FadeIn>

          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <form onSubmit={handleSave}>
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Account</h3>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
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
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Title
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Risk Manager, CFO"
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
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
        </div>
      </main>

      <FixedMobileFooter>
        {saveButton}
      </FixedMobileFooter>
    </div>
  );
}
