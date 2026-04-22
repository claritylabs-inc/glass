"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Copy, Check } from "lucide-react";

type InviteMode = "email" | "shareable";

type SuccessStateEmail = { kind: "email"; sentTo: string };
type SuccessStateLink = {
  kind: "link";
  url: string;
  maxUses?: number;
  invitationId: Id<"clientInvitations">;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

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
  const [success, setSuccess] = useState<
    SuccessStateEmail | SuccessStateLink | null
  >(null);
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
  const createEmail = useAction((api as any).clientInvitations.createEmail);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createShareable = useMutation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clientInvitations.createShareable,
  );

  const emailValid = contactEmail.includes("@") && contactEmail.includes(".");

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid) {
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
      setSuccess({
        kind: "link",
        url: inviteUrl,
        maxUses: maxUses ? Number(maxUses) : undefined,
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
            <TabsList variant="pill" className="w-full">
              <TabsTrigger value="email" className="flex-1">
                Email invite
              </TabsTrigger>
              <TabsTrigger value="shareable" className="flex-1">
                Shareable link
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="mt-6 space-y-4">
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <label htmlFor="companyName" className={LABEL_CLASSES}>
                    Client company name
                  </label>
                  <input
                    id="companyName"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Corp"
                    className={INPUT_CLASSES}
                  />
                </div>
                <div>
                  <label htmlFor="contactName" className={LABEL_CLASSES}>
                    Primary contact name
                  </label>
                  <input
                    id="contactName"
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Jane Smith"
                    className={INPUT_CLASSES}
                  />
                </div>
                <div>
                  <label htmlFor="contactEmail" className={LABEL_CLASSES}>
                    Primary contact email
                  </label>
                  <input
                    id="contactEmail"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="jane@acmecorp.com"
                    className={INPUT_CLASSES}
                  />
                </div>
                <div>
                  <label htmlFor="message" className={LABEL_CLASSES}>
                    Optional message
                  </label>
                  <textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="We'd love to help with your insurance…"
                    rows={3}
                    className={INPUT_CLASSES}
                  />
                </div>
                <PillButton
                  type="submit"
                  variant="primary"
                  disabled={!emailValid}
                  className="w-full"
                >
                  Send invite
                </PillButton>
              </form>
            </TabsContent>

            <TabsContent value="shareable" className="mt-6 space-y-4">
              <form onSubmit={handleShareableSubmit} className="space-y-4">
                <div>
                  <label htmlFor="maxUses" className={LABEL_CLASSES}>
                    Max uses{" "}
                    <span className="text-muted-foreground/60 font-normal">
                      (leave blank for unlimited)
                    </span>
                  </label>
                  <input
                    id="maxUses"
                    type="number"
                    min="1"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="Unlimited"
                    className={INPUT_CLASSES}
                  />
                </div>
                <div>
                  <label htmlFor="linkLabel" className={LABEL_CLASSES}>
                    Label{" "}
                    <span className="text-muted-foreground/60 font-normal">
                      (broker-facing only)
                    </span>
                  </label>
                  <input
                    id="linkLabel"
                    type="text"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder="Conference 2026"
                    className={INPUT_CLASSES}
                  />
                </div>
                <PillButton
                  type="submit"
                  variant="primary"
                  className="w-full"
                >
                  Create link
                </PillButton>
              </form>
            </TabsContent>
          </Tabs>
        ) : success.kind === "email" ? (
          <div className="mt-8 space-y-4 text-center">
            <p className="text-sm">
              Email sent to{" "}
              <span className="font-semibold">{success.sentTo}</span>.
            </p>
            <PillButton
              type="button"
              variant="secondary"
              onClick={handleClose}
              className="w-full"
            >
              Close
            </PillButton>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="text-sm font-medium">Shareable link generated</p>
            <div className="flex items-center gap-2 p-3 rounded-lg border border-foreground/8 bg-popover text-xs font-mono break-all">
              <span className="flex-1">{success.url}</span>
              <button
                type="button"
                onClick={() => handleCopy(success.url)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            {success.maxUses !== undefined && (
              <p className="text-xs text-muted-foreground">
                Max {success.maxUses} use{success.maxUses !== 1 ? "s" : ""}
              </p>
            )}
            <PillButton
              type="button"
              variant="secondary"
              onClick={handleClose}
              className="w-full"
            >
              Done
            </PillButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
