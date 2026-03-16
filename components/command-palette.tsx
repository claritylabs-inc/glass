"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Asterisk, Loader2 } from "lucide-react";
import { usePageContext } from "@/hooks/use-page-context";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "agent.claritylabs.inc";

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const { context: pageContext } = usePageContext();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
  }, []);

  // Cmd+K listener
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        // Don't open if already on a thread page with its own input
        if (open) {
          close();
        } else {
          setOpen(true);
        }
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [open, close]);

  // Auto-focus
  useEffect(() => {
    if (open) {
      // Delay to allow animation to start
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = value.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const threadId = await createThread({
        initialContext: pageContext ?? undefined,
        agentDomain: AGENT_DOMAIN,
      });
      await sendThreadMessage({ threadId, content });
      close();
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to start chat");
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/8 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            onClick={close}
          />

          {/* Palette */}
          <motion.div
            onClick={(e) => e.stopPropagation()}
            className="fixed top-[28%] left-1/2 z-50 w-[90vw] max-w-[480px] -translate-x-1/2"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            <form onSubmit={handleSubmit}>
              <div className="rounded-xl overflow-hidden shadow-2xl bg-white/95 backdrop-blur-sm border border-black/8">
                {/* Input row */}
                <div className="px-4 pt-3.5 pb-1.5">
                  <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Ask Cell anything..."
                    className="w-full bg-transparent outline-none text-body-sm text-foreground placeholder:text-muted-foreground/40"
                    disabled={sending}
                  />
                </div>

                {/* Bottom row */}
                <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
                  <div className="flex items-center gap-1.5 ml-1">
                    <Asterisk className="w-3.5 h-3.5 text-[#A0D2FA]" />
                    <span className="text-[11px] font-medium text-muted-foreground/40">Cell Agent</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/[0.04] text-muted-foreground/40 border border-foreground/6">
                      esc
                    </kbd>
                    <button
                      type="submit"
                      disabled={!value.trim() || sending}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-white disabled:opacity-20 transition-opacity cursor-pointer"
                    >
                      {sending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
