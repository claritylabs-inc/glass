"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

type Props = {
  open: boolean;
  onClose: () => void;
  applicationId: Id<"applications">;
};

export function SaveAsTemplateDialog({ open, onClose, applicationId }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const fromApplication = useMutation((api as any).applicationTemplates.fromApplication);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fromApplication({ applicationId, name: name.trim() });
      toast.success("Template saved!");
      setName("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Template name</label>
            <Input
              placeholder="e.g. CGL Roofing Contractor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save Template"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
