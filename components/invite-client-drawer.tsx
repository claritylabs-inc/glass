"use client";

import { useState, useRef, useCallback } from "react";
import { useAction, useMutation } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Copy, Check, X } from "lucide-react";

type InviteMode = "email" | "shareable";

type SuccessStateLink = {
  url: string;
  maxUses?: number;
  invitationId: Id<"clientInvitations">;
};

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

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
  const [success, setSuccess] = useState<SuccessStateLink | null>(null);
  const [copied, setCopied] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");

  const [maxUses, setMaxUses] = useState("");
  const [linkLabel, setLinkLabel] = useState("");

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createEmail = useAction((api as any).clientInvitations.createEmail);
  const createShareable = useMutation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clientInvitations.createShareable,
  );

  const emailValid = contactEmail.includes("@") && contactEmail.includes(".");

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsDraggingState(true);
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const delta = startX - ev.clientX;
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
      };
      const onUp = () => {
        isDragging.current = false;
        setIsDraggingState(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [width],
  );

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
      toast.success(`Invite sent to ${contactEmail}`);
      handleClose();
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
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={
            isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }
          }
          className="flex shrink-0 overflow-hidden h-full relative"
        >
          <div
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            {/* Header */}
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                Invite client
              </span>
              <button
                type="button"
                onClick={handleClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {!success ? (
                <Tabs
                  value={mode}
                  onValueChange={(v) => setMode(v as InviteMode)}
                >
                  <TabsList variant="pill" className="w-full">
                    <TabsTrigger value="email" className="flex-1">
                      Email invite
                    </TabsTrigger>
                    <TabsTrigger value="shareable" className="flex-1">
                      Shareable link
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="email" className="mt-4 space-y-4">
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

                  <TabsContent value="shareable" className="mt-4 space-y-4">
                    <form
                      onSubmit={handleShareableSubmit}
                      className="space-y-4"
                    >
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
              ) : (
                <div className="space-y-4">
                  <p className="text-sm font-medium">
                    Shareable link generated
                  </p>
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
                      Max {success.maxUses} use
                      {success.maxUses !== 1 ? "s" : ""}
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
