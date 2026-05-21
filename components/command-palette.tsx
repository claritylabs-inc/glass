"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Asterisk, Loader2 } from "lucide-react";
import { usePageContext } from "@/hooks/use-page-context";
import { getPublicAgentDomain } from "@/lib/domains";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { useThreadCacheActions } from "@/lib/sync/glass-cached-queries";

const AGENT_DOMAIN = getPublicAgentDomain();

export function CommandPalette() {
  const router = useRouter();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const { context: pageContext } = usePageContext();
  const viewerOrg = useCachedQuery(
    "commandPalette.viewerOrg",
    api.orgs.viewerOrg,
    {},
  );
  const viewer = useCachedQuery("commandPalette.viewer", api.users.viewer, {});
  const {
    appendOptimisticSend,
    markOptimisticSendFailed,
    seedOptimisticThread,
  } = useThreadCacheActions();

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
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = value.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const messageClientMutationId = createClientMutationId("message");
      const threadId = await createThread({
        initialContext: pageContext ?? undefined,
        agentDomain: AGENT_DOMAIN,
        clientMutationId: createClientMutationId("thread"),
      });
      if (viewerOrg?.org?._id && viewer?._id) {
        await seedOptimisticThread({
          threadId,
          orgId: viewerOrg.org._id,
          createdBy: viewer._id,
          initialContext: pageContext ?? undefined,
        });
        await appendOptimisticSend({
          threadId,
          orgId: viewerOrg.org._id,
          content,
          clientMutationId: messageClientMutationId,
          userId: viewer._id,
          userName: viewer.name ?? viewer.email ?? "You",
        });
      }
      close();
      router.push(`/agent/thread/${threadId}`);
      setSending(false);
      void sendThreadMessage({
        threadId,
        content,
        clientMutationId: messageClientMutationId,
      }).catch(async (error) => {
        if (viewerOrg?.org?._id) {
          await markOptimisticSendFailed({
            threadId,
            clientMutationId: messageClientMutationId,
            error:
              error instanceof Error ? error.message : "Failed to send message",
          });
        }
        toast.error("Failed to send message");
      });
    } catch {
      toast.error("Failed to start chat");
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
            transition={{ duration: 0.08, ease: [0.2, 0, 0, 1] }}
            onClick={close}
          />

          {/* Palette */}
          <motion.div
            onClick={(e) => e.stopPropagation()}
            className="fixed top-[28%] left-1/2 z-50 w-[90vw] max-w-120 -translate-x-1/2"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1, ease: [0.2, 0, 0, 1] }}
          >
            <form onSubmit={handleSubmit}>
              <div className="rounded-xl overflow-hidden shadow-2xl bg-white/95 dark:bg-popover/95 backdrop-blur-sm border border-black/8 dark:border-[#3a3a3a]">
                {/* Input row */}
                <div className="px-4 pt-3.5 pb-1.5">
                  <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Ask Glass anything..."
                    className="w-full bg-transparent outline-none text-body-sm text-foreground placeholder:text-muted-foreground/40"
                    disabled={sending}
                  />
                </div>

                {/* Bottom row */}
                <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
                  <div className="flex items-center gap-1.5 ml-1">
                    <Asterisk className="w-3.5 h-3.5 text-primary-light" />
                    <span className="text-label-sm font-medium text-muted-foreground/40">
                      Glass
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/4 text-muted-foreground/40 border border-foreground/6">
                      esc
                    </kbd>
                    <button
                      type="submit"
                      disabled={!value.trim() || sending}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-20 disabled:hover:opacity-20"
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
