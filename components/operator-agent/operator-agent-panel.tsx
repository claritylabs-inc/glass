"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { ChevronDown, Plus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useStickToBottom } from "use-stick-to-bottom";

import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import { ThreadAttachmentChip } from "@/components/agent-thread/thread-attachment-chip";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input/prompt-input";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  SpotPromptInput,
  type SpotPromptInputHandle,
} from "@/components/spot-prompt-input";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { usePageContext } from "@/hooks/use-page-context";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
  type OperatorAgentAttachment,
  type OperatorAgentConfirmation,
} from "@/lib/operator-agent-api";
import { uploadPromptFiles } from "@/lib/thread-prompt";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
  operatorPageContextFromPathname,
  operatorPageContextKey,
  operatorPageContextLabel,
} from "./operator-page-context";
import { useOptionalOperatorAgent } from "./operator-agent-provider";

const EMPTY_PROMPTS = [
  "Find an account, policy, or operational issue",
  "Make a change across the operator portal",
  "Check system health and recent failures",
];

const CONTEXT_PROMPTS = [
  "Summarize this page and flag anything that needs attention",
  "Update this record from the information I provide",
  "Show me the most useful next actions",
];

const OPERATOR_ATTACHMENT_MAX_FILES = 10;
const OPERATOR_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

function OperatorMessageAttachments({
  threadId,
  attachments,
}: {
  threadId: string;
  attachments: OperatorAgentAttachment[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <OperatorAttachmentChip
          key={attachment.fileId}
          threadId={threadId}
          attachment={attachment}
        />
      ))}
    </div>
  );
}

function OperatorAttachmentChip({
  threadId,
  attachment,
}: {
  threadId: string;
  attachment: OperatorAgentAttachment;
}) {
  const url = useQuery(operatorAgentApi.getAttachmentUrl, {
    threadId,
    fileId: attachment.fileId,
  });
  return (
    <ThreadAttachmentChip
      attachment={attachment}
      resolvedUrl={url}
      isLoading={url === undefined}
      size="compact"
    />
  );
}

function ConfirmationCard({
  confirmation,
  busy,
  onDecision,
}: {
  confirmation: OperatorAgentConfirmation;
  busy: boolean;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  return (
    <div className="mt-3 border-l-2 border-border-emphasized pl-3">
      <p className={cn("text-foreground", typeStyle("body.medium"))}>
        {confirmation.title}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <PillButton
          size="compact"
          variant="secondary"
          disabled={busy}
          onClick={() => onDecision("reject")}
        >
          Cancel
        </PillButton>
        <PillButton
          size="compact"
          variant={confirmation.destructive ? "destructive" : "primary"}
          disabled={busy}
          onClick={() => onDecision("approve")}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Confirm
        </PillButton>
      </div>
    </div>
  );
}

function EmptyThread({
  contextual,
  onSelect,
}: {
  contextual: boolean;
  onSelect: (prompt: string) => void;
}) {
  const prompts = contextual ? CONTEXT_PROMPTS : EMPTY_PROMPTS;

  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <LogoIcon className="mb-4 text-muted-foreground" size={24} static />
      <h2 className={cn("text-foreground", typeStyle("heading.micro"))}>
        What should I handle?
      </h2>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          typeStyle("caption.default"),
        )}
      >
        I can investigate, update records, and run privileged operator tools.
        You approve sensitive actions before they execute.
      </p>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className={cn(
              "w-full py-3 text-left text-muted-foreground transition-colors hover:text-foreground",
              typeStyle("caption.medium"),
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OperatorAgentPanel({ pagePanel }: { pagePanel?: ReactNode }) {
  const controller = useOptionalOperatorAgent();
  const pathname = usePathname();
  const { context: registeredPageContext } = usePageContext();
  const promptRef = useRef<SpotPromptInputHandle>(null);
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirmationBusyId, setConfirmationBusyId] = useState<string | null>(
    null,
  );
  const rawThreads = useQuery(operatorAgentApi.listThreads, { limit: 40 });
  const threads = useMemo(
    () => normalizeOperatorAgentThreads(rawThreads),
    [rawThreads],
  );
  const activeThreadId = controller?.activeThreadId ?? null;
  const rawThread = useQuery(
    operatorAgentApi.getThread,
    activeThreadId ? { threadId: activeThreadId } : "skip",
  );
  const detail = useMemo(
    () => normalizeOperatorAgentThread(rawThread),
    [rawThread],
  );
  const createThread = useMutation(operatorAgentApi.createThread);
  const generateUploadUrl = useMutation(operatorAgentApi.generateUploadUrl);
  const sendMessage = useMutation(operatorAgentApi.sendMessage);
  const cancelRun = useMutation(operatorAgentApi.cancelRun);
  const confirmAction = useMutation(operatorAgentApi.confirmAction);
  const fallbackPageContext = useMemo(
    () => operatorPageContextFromPathname(pathname),
    [pathname],
  );
  const currentPageContext = registeredPageContext ?? fallbackPageContext;
  const currentPageContextKey = currentPageContext
    ? operatorPageContextKey(currentPageContext)
    : null;
  const attachedPageContext =
    currentPageContext &&
    currentPageContextKey !== controller?.detachedPageContextKey
      ? currentPageContext
      : null;
  const activeThread =
    detail.thread ??
    threads.find((thread) => thread.id === activeThreadId) ??
    null;
  const threadConfirmation = detail.pendingConfirmation;
  const running = detail.activeRun || submitting;

  useEffect(() => {
    if (!controller || controller.activeThreadId || threads.length === 0)
      return;
    controller.setActiveThreadId(threads[0].id);
  }, [controller, threads]);

  useEffect(() => {
    if (detail.messages.length === 0) return;
    void scrollToBottom("instant");
  }, [detail.messages.length, scrollToBottom]);

  const startNewThread = useCallback(async () => {
    if (!controller) return null;
    try {
      const result = await createThread(
        attachedPageContext ? { initialContext: attachedPageContext } : {},
      );
      const threadId = result;
      controller.setActiveThreadId(threadId);
      return threadId;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a task",
      );
      return null;
    }
  }, [attachedPageContext, controller, createThread]);

  const submit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((!text && message.files.length === 0) || !controller || submitting)
        return;
      setSubmitting(true);
      try {
        const threadId = controller.activeThreadId ?? (await startNewThread());
        if (!threadId) return;
        const attachments = await uploadPromptFiles(
          message.files,
          generateUploadUrl,
        );
        if (attachments.length !== message.files.length) {
          throw new Error("One or more files could not be uploaded");
        }
        await sendMessage({
          threadId,
          content: text || "(attached files)",
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(attachedPageContext ? { pageContext: attachedPageContext } : {}),
        });
        void scrollToBottom("smooth");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "The operator task could not be sent",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      attachedPageContext,
      controller,
      generateUploadUrl,
      scrollToBottom,
      sendMessage,
      startNewThread,
      submitting,
    ],
  );

  const stop = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await cancelRun({ threadId: activeThreadId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not stop the task",
      );
    }
  }, [activeThreadId, cancelRun]);

  const decide = useCallback(
    async (
      confirmation: OperatorAgentConfirmation,
      decision: "approve" | "reject",
    ) => {
      if (!activeThreadId) return;
      setConfirmationBusyId(confirmation.id);
      try {
        await confirmAction({
          threadId: activeThreadId,
          confirmationId: confirmation.id,
          decision,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not record the decision",
        );
      } finally {
        setConfirmationBusyId(null);
      }
    },
    [activeThreadId, confirmAction],
  );

  if (!controller) return null;

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col border-l border-border bg-background"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props) => (
              <button
                {...props}
                type="button"
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground outline-none focus-visible:underline focus-visible:underline-offset-4",
                  typeStyle("body.medium"),
                )}
              >
                <span className="truncate">
                  {activeThread?.title ?? "Operator agent"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            )}
          />
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="max-h-80 w-72 max-w-[calc(100vw-1.5rem)]"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent tasks</DropdownMenuLabel>
              {rawThreads === undefined ? (
                <DropdownMenuItem disabled className="h-16 justify-center">
                  <Spinner className="text-muted-foreground" />
                  <span className="sr-only">Loading tasks</span>
                </DropdownMenuItem>
              ) : threads.length === 0 ? (
                <DropdownMenuItem disabled className="py-3">
                  No operator tasks yet.
                </DropdownMenuItem>
              ) : (
                <DropdownMenuRadioGroup
                  value={activeThreadId}
                  onValueChange={(threadId) => {
                    if (typeof threadId !== "string") return;
                    controller.setActiveThreadId(threadId);
                  }}
                >
                  {threads.map((thread) => (
                    <DropdownMenuRadioItem
                      key={thread.id}
                      value={thread.id}
                      className="items-start py-1.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {thread.title}
                        </span>
                        {thread.lastMessageAt ? (
                          <span
                            className={cn(
                              "block text-muted-foreground",
                              typeStyle("label.tag"),
                            )}
                          >
                            {dayjs(thread.lastMessageAt).format("MMM D, h:mm A")}
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <PillButton
          variant="icon"
          iconOnly
          label="New operator task"
          onClick={() => void startNewThread()}
        >
          <Plus className="size-4" />
        </PillButton>
      </header>

      {currentPageContext ? (
        <div className="flex min-h-10 shrink-0 items-center border-b border-border px-3 py-1.5">
          {attachedPageContext ? (
            <div
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-full border border-input px-2.5 py-1 text-muted-foreground",
                typeStyle("label.tag"),
              )}
            >
              <span className="truncate">
                Using {operatorPageContextLabel(attachedPageContext)}
              </span>
              <button
                type="button"
                aria-label="Remove current page context"
                className="shrink-0 transition-colors hover:text-foreground"
                onClick={() =>
                  currentPageContextKey &&
                  controller.detachPageContext(currentPageContextKey)
                }
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <PillButton
              variant="ghost"
              size="compact"
              onClick={controller.attachPageContext}
            >
              Use current page
            </PillButton>
          )}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hide"
      >
        <div ref={contentRef} className="min-h-full space-y-5 px-4 py-4">
          {activeThreadId && rawThread === undefined ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : detail.messages.length === 0 ? (
            <EmptyThread
              contextual={Boolean(attachedPageContext)}
              onSelect={(prompt) => promptRef.current?.setValueAndFocus(prompt)}
            />
          ) : (
            detail.messages.map((message) => {
              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end pl-10" : "pr-4",
                  )}
                >
                  <div
                    className={
                      message.role === "user" ? "max-w-[92%]" : "w-full"
                    }
                  >
                    <ThreadMessageBubble
                      role={message.role === "user" ? "user" : "agent"}
                      isOwnMessage={message.role === "user"}
                      isError={message.status === "error"}
                    >
                      {message.content ? (
                        message.role === "assistant" ? (
                          <ProseMarkdown gfm breaks>
                            {message.content}
                          </ProseMarkdown>
                        ) : (
                          <p className="whitespace-pre-wrap">
                            {message.content}
                          </p>
                        )
                      ) : null}
                      {message.attachments?.length && activeThreadId ? (
                        <OperatorMessageAttachments
                          threadId={activeThreadId}
                          attachments={message.attachments}
                        />
                      ) : null}
                    </ThreadMessageBubble>
                  </div>
                </div>
              );
            })
          )}
          {threadConfirmation ? (
            <ConfirmationCard
              confirmation={threadConfirmation}
              busy={confirmationBusyId === threadConfirmation.id}
              onDecision={(decision) =>
                void decide(threadConfirmation, decision)
              }
            />
          ) : null}
          {detail.activeRun && !threadConfirmation ? (
            <div
              className={cn(
                "flex items-center gap-2 text-muted-foreground",
                typeStyle("caption.default"),
              )}
            >
              <Spinner className="size-3.5" />
              Working…
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="shrink-0 border-t border-border px-3 pt-3"
        style={{
          paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <SpotPromptInput
          ref={promptRef}
          onSubmit={submit}
          onStop={() => void stop()}
          placeholder="Ask the operator agent…"
          multipleAttachments
          maxFiles={OPERATOR_ATTACHMENT_MAX_FILES}
          maxFileSize={OPERATOR_ATTACHMENT_MAX_BYTES}
          onAttachmentError={(message) => toast.error(message)}
          status={running ? "submitted" : undefined}
          submittedLabel="Working"
        />
      </div>

      {pagePanel ? (
        <div className="absolute inset-0 z-10 bg-background">{pagePanel}</div>
      ) : null}
    </div>
  );
}
