"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { usePageContext } from "@/hooks/use-page-context";
import { PrismPromptInput } from "@/components/prism-prompt-input";
import { Asterisk } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/policies": "Policies",
  "/applications": "Applications",
  "/connections": "Connections",
  "/agent": "Agent",
  "/settings": "Settings",
  "/profile": "Profile",
};

const HIDDEN_PATHS = ["/agent", "/settings", "/profile"];

const COLLAPSE_DELAY = 800;

export function AskPrismInput() {
  const pathname = usePathname();
  const router = useRouter();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const { context: pageContext } = usePageContext();

  // expanded = full input visible, engaged = user is typing or focused
  const [expanded, setExpanded] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearCollapseTimer = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const scheduleCollapse = () => {
    clearCollapseTimer();
    collapseTimer.current = setTimeout(() => {
      if (!engaged) setExpanded(false);
    }, COLLAPSE_DELAY);
  };

  const handleMouseEnter = () => {
    clearCollapseTimer();
    setExpanded(true);
  };

  const handleMouseLeave = () => {
    if (!engaged) scheduleCollapse();
  };

  const handleFocus = () => {
    clearCollapseTimer();
    setEngaged(true);
    setExpanded(true);
  };

  const handleBlur = () => {
    setEngaged(false);
    scheduleCollapse();
  };

  useEffect(() => {
    return () => clearCollapseTimer();
  }, []);

  // Get context pill label — prefer page context summary, fall back to URL-derived label
  const segments = pathname.split("/").filter(Boolean);
  let urlLabel: string;
  if (segments.length >= 2 && segments[0] === "policies") {
    urlLabel = `Policy ${segments[1]}`;
  } else if (segments.length >= 2 && segments[0] === "applications") {
    urlLabel = `Application ${segments[1]}`;
  } else {
    const basePath = "/" + (segments[0] ?? "");
    urlLabel = PAGE_LABELS[basePath] ?? "Page";
  }
  const contextLabel = pageContext?.summary ?? urlLabel;

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const content = message.text.trim();
    if (!content) return;
    try {
      const threadId = await createThread({
        initialContext: pageContext ?? undefined,
        agentDomain: AGENT_DOMAIN,
      });
      await sendThreadMessage({ threadId, content });
      router.push(`/agent/thread/${threadId}`);
    } catch {
      toast.error("Failed to start chat");
      throw new Error("Failed");
    }
  }, [createThread, sendThreadMessage, pageContext, router]);

  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Gradient fade */}
      <motion.div
        animate={{ height: expanded ? 64 : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--background) 0%, transparent) 0%, color-mix(in srgb, var(--background) 40%, transparent) 50%, color-mix(in srgb, var(--background) 80%, transparent) 100%)",
        }}
      />
      <motion.div
        className="pointer-events-auto px-4 md:px-6 lg:px-8"
        animate={{ backgroundColor: expanded ? "color-mix(in srgb, var(--background) 80%, transparent)" : "transparent" }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-2xl mx-auto">
          <AnimatePresence mode="wait">
            {expanded ? (
              <motion.div
                key="input"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                onFocus={handleFocus}
                onBlur={handleBlur}
              >
                <PrismPromptInput
                  onSubmit={handleSubmit}
                  placeholder="Ask Prism..."
                  contextLabel={contextLabel}
                  showAttach={false}
                />
              </motion.div>
            ) : (
              <motion.div
                key="pill"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex justify-center py-1"
              >
                <button
                  type="button"
                  onClick={() => { setExpanded(true); setEngaged(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-foreground/8 bg-popover text-label-sm text-muted-foreground/60 shadow-sm hover:text-foreground hover:border-foreground/15 transition-colors cursor-pointer"
                >
                  <Asterisk className="w-3 h-3 text-primary-light" />
                  Ask Prism
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
