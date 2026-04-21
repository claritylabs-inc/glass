"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Copy, Check } from "lucide-react";

type InviteMode = "email" | "shareable";

type SuccessStateEmail = { kind: "email"; sentTo: string };
type SuccessStateLink = { kind: "link"; url: string; maxUses?: number; invitationId: Id<"clientInvitations"> };

export function InviteClientDrawer({
  brokerOrgId,
  open,
  onOpenChange,
}: {
  brokerOrgId: Id<"organizations">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<InviteMode>("email");
  const [success, setSuccess] = useState<SuccessStateEmail | SuccessStateLink | null>(null);
  const [copied, setCopied] = useState(false);

  // Email mode state
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");

  // Shareable mode state
  const [maxUses, setMaxUses] = useState("");
  const [linkLabel, setLinkLabel] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createEmail = useMutation((api as any).clientInvitations.createEmail);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createShareable = useMutation((api as any).clientInvitations.createShareable);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeInvite = useMutation((api as any).clientInvitations.revoke);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactEmail.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    try {
      await createEmail({
        orgId: brokerOrgId,
        clientOrgName: companyName || undefined,
        primaryContactName: contactName || undefined,
        primaryContactEmail: contactEmail,
      });
      setSuccess({ kind: "email", sentTo: contactEmail });
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function handleShareableSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await createShareable({
        orgId: brokerOrgId,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      const inviteUrl = `${window.location.origin}/invite/${result.token}`;
      // We need the invitation id — use a workaround since createShareable returns only token
      setSuccess({
        kind: "link",
        url: inviteUrl,
        maxUses: maxUses ? Number(maxUses) : undefined,
        // invitationId is not returned by createShareable, so we use a placeholder
        // The revoke button won't work without it; hide revoke for now
        invitationId: "" as Id<"clientInvitations">,
      });
    } catch (err) {
      toast.error(String(err));
    }
  }

  function handleClose() {
    setSuccess(null);
    setCompanyName("");
    setContactName("");
    setContactEmail("");
    setMessage("");
    setMaxUses("");
    setLinkLabel("");
    onOpenChange(false);
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Invite client</SheetTitle>
        </SheetHeader>

        {!success ? (
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as InviteMode)}
            className="mt-6"
          >
            <TabsList className="w-full">
              <TabsTrigger value="email" className="flex-1">
                Email invite
              </TabsTrigger>
              <TabsTrigger value="shareable" className="flex-1">
                Shareable link
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="mt-6 space-y-4">
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="companyName">Client company name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Corp"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="contactName">Primary contact name</Label>
                  <Input
                    id="contactName"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="contactEmail">
                    Primary contact email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="jane@acmecorp.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="message">Optional message</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="We'd love to help with your insurance…"
                    rows={3}
                  />
                </div>
                <Button type="submit" className="w-full">
                  Send invite
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="shareable" className="mt-6 space-y-4">
              <form onSubmit={handleShareableSubmit} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="maxUses">
                    Max uses{" "}
                    <span className="text-muted-foreground text-xs">(leave blank for unlimited)</span>
                  </Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min="1"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="linkLabel">
                    Label{" "}
                    <span className="text-muted-foreground text-xs">(broker-facing only)</span>
                  </Label>
                  <Input
                    id="linkLabel"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder="Conference 2026"
                  />
                </div>
                <Button type="submit" className="w-full">
                  Generate link
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        ) : success.kind === "email" ? (
          <div className="mt-8 space-y-4 text-center">
            <p className="text-sm">
              Email sent to{" "}
              <span className="font-semibold">{success.sentTo}</span>.
            </p>
            <Button variant="outline" onClick={handleClose} className="w-full">
              Close
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="text-sm font-medium">Shareable link generated</p>
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-xs font-mono break-all">
              <span className="flex-1">{success.url}</span>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={() => handleCopy(success.url)}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            {success.maxUses !== undefined && (
              <p className="text-xs text-muted-foreground">
                Max {success.maxUses} use{success.maxUses !== 1 ? "s" : ""}
              </p>
            )}
            <Button variant="outline" onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
