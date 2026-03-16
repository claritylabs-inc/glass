"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { usePageContext } from "@/hooks/use-page-context";
import { ChatInput, ChatInputOverlay } from "@/components/chat-input";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "agent.claritylabs.inc";

const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/policies": "Policies",
  "/quotes": "Quotes",
  "/applications": "Applications",
  "/connections": "Connections",
  "/agent": "Agent",
  "/settings": "Settings",
  "/profile": "Profile",
};

const HIDDEN_PATHS = ["/agent", "/settings", "/profile"];

export function AskCellInput() {
  const pathname = usePathname();
  const router = useRouter();
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);
  const { context: pageContext } = usePageContext();

  // Get context pill label
  const segments = pathname.split("/").filter(Boolean);
  const basePath = segments.length > 0 ? "/" + segments[0] : "/";
  const contextLabel = PAGE_LABELS[basePath] ?? "Page";

  const handleSend = useCallback(async (content: string) => {
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

  // Don't show on pages that have their own input or where it doesn't make sense
  // (must be after all hooks to avoid "rendered fewer hooks" error)
  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <ChatInputOverlay>
      <ChatInput
        onSend={handleSend}
        placeholder="Ask Cell..."
        contextLabel={contextLabel}
        showAttach={false}
      />
    </ChatInputOverlay>
  );
}
