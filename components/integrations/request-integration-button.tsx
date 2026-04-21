// components/integrations/request-integration-button.tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface RequestIntegrationButtonProps {
  clientOrgId: string;
}

export function RequestIntegrationButton({ clientOrgId }: RequestIntegrationButtonProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"accounting" | "hris" | "payroll" | "">("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const createRequest = useMutation((api as any).integrationRequests.create);

  async function handleSubmit() {
    if (!category) return;
    setLoading(true);
    try {
      await createRequest({
        clientOrgId,
        category,
        message: message.trim() || undefined,
      });
      toast.success("Integration request sent to client");
      setOpen(false);
      setCategory("");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PillButton variant="secondary" onClick={() => setOpen(true)}>
        Request integration
      </PillButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request integration</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-foreground">
                Category
              </label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as "accounting" | "hris" | "payroll")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accounting">Accounting</SelectItem>
                  <SelectItem value="hris">HRIS</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-foreground">
                Message (optional)
              </label>
              <Textarea
                placeholder="e.g. We need payroll data for the WC application."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
            <PillButton onClick={handleSubmit} disabled={!category || loading}>
              Send request
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
