"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { X } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

export function InviteMemberDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const inviteMember = useMutation(api.orgs.inviteMember);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);

  function resetAndClose() {
    setEmail("");
    setRole("member");
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    try {
      await inviteMember({ email, role });
      toast.success(`Invitation sent to ${email}`);
      resetAndClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invitation";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

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

  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }}
          className="max-lg:!fixed max-lg:!inset-0 max-lg:!z-50 max-lg:!w-full flex shrink-0 overflow-hidden h-full relative"
        >
          <div
            onPointerDown={onPointerDown}
            className="hidden lg:block absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="max-lg:!w-full flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                Invite team member
              </span>
              <button
                type="button"
                onClick={resetAndClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            >
              <p className="text-body-sm text-muted-foreground">
                Send an invitation to join your organization. They&apos;ll receive an email with
                instructions.
              </p>

              <div>
                <label htmlFor="invite-email" className={LABEL_CLASSES}>
                  Email address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className={INPUT_CLASSES}
                />
              </div>

              <div>
                <span className={LABEL_CLASSES}>Role</span>
                <div className="flex gap-2">
                  {(["member", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 py-2 rounded-lg border text-body-sm font-medium transition-colors cursor-pointer ${
                        role === r
                          ? "border-foreground/15 bg-foreground/[0.03] text-foreground"
                          : "border-foreground/6 text-muted-foreground hover:border-foreground/10"
                      }`}
                    >
                      {r === "admin" ? "Admin" : "Member"}
                    </button>
                  ))}
                </div>
                <p className="text-label-sm text-muted-foreground/60 mt-1.5">
                  {role === "admin"
                    ? "Admins can manage connections, settings, and team members."
                    : "Members can view policies and use the agent, but can't manage connections or settings."}
                </p>
              </div>

              <PillButton
                type="submit"
                variant="primary"
                disabled={sending || !email}
                className="w-full"
              >
                {sending ? "Sending…" : "Send invitation"}
              </PillButton>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
