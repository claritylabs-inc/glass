"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  GlassPromptInput,
  type GlassPromptInputHandle,
} from "@/components/glass-prompt-input";
import { usePageContext } from "@/hooks/use-page-context";
import type { PageContext } from "@/hooks/use-page-context";
import { useStartAgentThread } from "@/hooks/use-start-agent-thread";

export const OPEN_COMMAND_PALETTE_EVENT = "glass:open-command-palette";

export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

type PromptReference = NonNullable<PromptInputMessage["references"]>[number];

function pageContextReference(
  pageContext: PageContext | null,
): PromptReference | null {
  if (!pageContext?.entityId) return null;

  if (pageContext.pageType === "policy" || pageContext.pageType === "quote") {
    return {
      kind: pageContext.pageType,
      id: pageContext.entityId,
      label:
        pageContext.summary ??
        (pageContext.pageType === "quote" ? "Current quote" : "Current policy"),
    };
  }

  if (pageContext.pageType === "requirement") {
    return {
      kind: "requirement",
      id: pageContext.entityId,
      label: pageContext.summary ?? "Current requirement",
    };
  }

  return null;
}

export function CommandPalette() {
  const { context: pageContext } = usePageContext();
  const { agentBranding, startAgentThread, viewerOrg } =
    useStartAgentThread("commandPalette");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const promptRef = useRef<GlassPromptInputHandle>(null);
  const defaultReference = pageContextReference(pageContext);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          close();
        } else {
          setOpen(true);
        }
      }
    };

    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => promptRef.current?.setValueAndFocus(""));
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (sending) return;

      setSending(true);
      try {
        const threadId = await startAgentThread(
          message,
          pageContext ?? undefined,
        );
        if (threadId) {
          close();
        }
      } finally {
        setSending(false);
      }
    },
    [close, pageContext, sending, startAgentThread],
  );

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08, ease: "linear" }}
            onClick={close}
          />
          <motion.div
            className="fixed top-[9vh] left-1/2 z-50 w-[min(92vw,45rem)] -translate-x-1/2"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.08, ease: "linear" }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                close();
              }
            }}
          >
            <GlassPromptInput
              ref={promptRef}
              onSubmit={handleSubmit}
              placeholder="Ask Glass anything..."
              defaultReferences={
                defaultReference ? [defaultReference] : undefined
              }
              disabled={sending}
              status={sending ? "submitted" : "ready"}
              agentBranding={agentBranding}
              orgId={viewerOrg?.org?._id}
              variant="command"
            />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
