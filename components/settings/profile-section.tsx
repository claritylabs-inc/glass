"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2 } from "lucide-react";
import { useSettingsActions } from "@/app/settings/page";

const inputClass =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const labelClass = "text-label-sm font-medium text-muted-foreground block mb-1.5";

export function ProfileSection() {
  const viewer = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const { setActions } = useSettingsActions();

  // Hydrate from server
  useEffect(() => {
    if (!viewer) return;
    setName(viewer.name ?? "");
    setTitle(viewer.title ?? "");
    setPhone(viewer.phone ?? "");
  }, [viewer]);

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim() || undefined,
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  if (viewer === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-lg">
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Personal profile</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          {/* Email — read-only */}
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={viewer?.email ?? ""}
              readOnly
              disabled
              className={`${inputClass} opacity-50 cursor-not-allowed`}
            />
          </div>

          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Role / title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Founder, Ops Lead, etc."
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Mobile number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className={inputClass}
            />
            <p className="text-label-sm text-muted-foreground/60 mt-1.5">
              Used for iMessage access to your Glass agent. Stored in E.164 format.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-foreground/6 flex justify-end">
          <PillButton type="submit" disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </PillButton>
        </div>
      </div>
    </form>
  );
}
