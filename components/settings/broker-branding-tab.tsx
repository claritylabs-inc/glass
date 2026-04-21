"use client";

import { useState, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BrokerBrandingTab() {
  const currentOrg = useCurrentOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateBranding = useMutation((api as any).organizations.updateBrokerBranding);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateUploadUrl = useMutation((api as any).organizations.generateLogoUploadUrl);

  const org = currentOrg?.org;
  const orgId = currentOrg?.orgId as Id<"organizations"> | undefined;

  const [brandingColor, setBrandingColor] = useState(
    (org as { brandingColor?: string } | undefined)?.brandingColor ?? "#6366f1",
  );
  const [agentDisplayName, setAgentDisplayName] = useState(
    (org as { agentDisplayName?: string } | undefined)?.agentDisplayName ?? "",
  );
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    try {
      await updateBranding({
        brokerOrgId: orgId,
        brandingColor,
        agentDisplayName: agentDisplayName || undefined,
      });
      toast.success("Branding saved");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    if (!orgId) return;
    try {
      const uploadUrl = await generateUploadUrl({ brokerOrgId: orgId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { storageId } = await res.json();
      await updateBranding({ brokerOrgId: orgId, logoStorageId: storageId });
      toast.success("Logo updated");
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-lg font-semibold">Branding</h2>

      <div className="space-y-4">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            {(org as { iconStorageId?: string } | undefined)?.iconStorageId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/storage/${(org as { iconStorageId: string }).iconStorageId}`}
                alt="Logo"
                className="w-12 h-12 rounded-md object-cover border"
              />
            ) : (
              <div className="w-12 h-12 rounded-md border bg-muted flex items-center justify-center text-muted-foreground text-xs">
                No logo
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload logo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoUpload(file);
              }}
            />
          </div>
        </div>

        {/* Accent color */}
        <div className="space-y-2">
          <Label htmlFor="brandingColor">Accent color</Label>
          <div className="flex items-center gap-3">
            <input
              id="brandingColor"
              type="color"
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              className="w-10 h-10 rounded cursor-pointer border"
            />
            <Input
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              className="w-32 font-mono"
              placeholder="#6366f1"
            />
            <div
              className="w-10 h-10 rounded-md border"
              style={{ backgroundColor: brandingColor }}
            />
          </div>
        </div>

        {/* Agent display name */}
        <div className="space-y-2">
          <Label htmlFor="agentDisplayName">Agent display name</Label>
          <Input
            id="agentDisplayName"
            value={agentDisplayName}
            onChange={(e) => setAgentDisplayName(e.target.value)}
            placeholder="Glass Assistant"
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            Shown to clients as the AI agent name.
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </div>
  );
}
