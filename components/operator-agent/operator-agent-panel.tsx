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

import { AgentThinkingBubble } from "@/components/agent-thread/agent-thinking-bubble";
import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import { ThreadAttachmentChip } from "@/components/agent-thread/thread-attachment-chip";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input/prompt-input";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  ChatInputOverlay,
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
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContext } from "@/hooks/use-page-context";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
  type OperatorAgentAttachment,
  type OperatorAgentConfirmation,
  type OperatorAgentMessage,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { uploadPromptFiles } from "@/lib/thread-prompt";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
  operatorPageContextFromPathname,
  operatorPageContextKey,
  operatorPageContextLabel,
  operatorPageContextsShareScope,
} from "./operator-page-context";
import { useOptionalOperatorAgent } from "./operator-agent-provider";
import { OperatorThreadChannelIcon } from "./operator-thread-channel";

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
const OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES = 50 * 1024 * 1024;
const OPERATOR_ATTACHMENT_ACCEPT =
  ".pdf,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.xml,.docx,.pptx,.jpg,.jpeg,.png,.gif,.webp";

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
    <div className="border-l-2 border-border-emphasized pl-3">
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

function operatorBubbleChannel(channel: OperatorAgentMessage["channel"]) {
  return channel === "mcp" ? "chat" : channel;
}

function operatorInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function OperatorMessageRow({
  threadId,
  message,
  showThinking,
}: {
  threadId: string;
  message: OperatorAgentMessage;
  showThinking: boolean;
}) {
  const bubbleChannel = operatorBubbleChannel(message.channel);
  const content =
    message.content.trim() ||
    (message.status === "error"
      ? "The operator task failed."
      : message.status === "cancelled"
        ? "Task stopped."
        : "");
  const attachments = message.attachments?.length ? (
    <OperatorMessageAttachments
      threadId={threadId}
      attachments={message.attachments}
    />
  ) : null;

  if (message.role === "assistant") {
    if (!showThinking && !content && !attachments) return null;

    return (
      <div className="w-full">
        {showThinking ? (
          <AgentThinkingBubble />
        ) : (
          <ThreadMessageBubble
            role="agent"
            channel={bubbleChannel}
            isError={message.status === "error"}
          >
            {content ? (
              <ProseMarkdown
                gfm
                breaks
                compact={message.channel === "imessage"}
              >
                {content}
              </ProseMarkdown>
            ) : null}
            {attachments}
          </ThreadMessageBubble>
        )}
      </div>
    );
  }

  const displayName = message.userName?.trim() || "Operator";

  return (
    <div className="ml-auto flex w-fit max-w-lg flex-row-reverse items-start gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/8">
        <span className={cn("text-foreground/60", typeStyle("caption.medium"))}>
          {operatorInitials(displayName)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center justify-end gap-2">
          <p
            className={cn(
              "min-w-0 max-w-[min(24rem,70vw)] truncate text-muted-foreground/50",
              typeStyle("caption.medium"),
            )}
            title={displayName}
          >
            {displayName}
          </p>
          <OperatorThreadChannelIcon
            channel={message.channel}
            className="size-3 shrink-0 text-muted-foreground/45"
          />
          <span className="text-muted-foreground/30">·</span>
          <span
            className={cn(
              "shrink-0 text-muted-foreground/45",
              typeStyle("caption.default"),
            )}
          >
            {formatDisplayDateTime(message.createdAt)}
          </span>
        </div>
        <ThreadMessageBubble
          role="user"
          channel={bubbleChannel}
          isOwnMessage
          isError={message.status === "error"}
        >
          {content ? <p className="whitespace-pre-wrap">{content}</p> : null}
          {attachments}
        </ThreadMessageBubble>
      </div>
    </div>
  );
}

function OperatorConversation({
  variant,
  activeThreadId,
  loading,
  detail,
  contextual,
  confirmationBusyId,
  onSelectPrompt,
  onDecision,
  composer,
}: {
  variant: "rail" | "page";
  activeThreadId: string | null;
  loading: boolean;
  detail: OperatorAgentThreadDetail;
  contextual: boolean;
  confirmationBusyId: string | null;
  onSelectPrompt: (prompt: string) => void;
  onDecision: (
    confirmation: OperatorAgentConfirmation,
    decision: "approve" | "reject",
  ) => void;
  composer: ReactNode;
}) {
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  useEffect(() => {
    if (detail.messages.length === 0) return;
    void scrollToBottom("instant");
  }, [activeThreadId, detail.messages.length, scrollToBottom]);

  const confirmation = detail.pendingConfirmation;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide p-4 pr-5"
      >
        <div
          ref={contentRef}
          className="mx-auto min-h-full w-full max-w-3xl space-y-4"
        >
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : detail.messages.length === 0 ? (
            <EmptyThread contextual={contextual} onSelect={onSelectPrompt} />
          ) : (
            detail.messages.map((message) => (
              <OperatorMessageRow
                key={message.id}
                threadId={activeThreadId ?? ""}
                message={message}
                showThinking={message.status === "processing" && !confirmation}
              />
            ))
          )}
          {confirmation ? (
            <div className="w-full">
              <ConfirmationCard
                confirmation={confirmation}
                busy={confirmationBusyId === confirmation.id}
                onDecision={(decision) => onDecision(confirmation, decision)}
              />
            </div>
          ) : null}
          {detail.messages.length > 0 ? <div className="h-40" /> : null}
        </div>
      </div>
      <ChatInputOverlay compact={variant === "rail"}>
        {composer}
      </ChatInputOverlay>
    </div>
  );
}

export function OperatorAgentPanel({
  pagePanel,
  variant = "rail",
  threadId,
  showHeader = true,
}: {
  pagePanel?: ReactNode;
  variant?: "rail" | "page";
  threadId?: string;
  showHeader?: boolean;
}) {
  const controller = useOptionalOperatorAgent();
  const pathname = usePathname();
  const { context: registeredPageContext } = usePageContext();
  const promptRef = useRef<SpotPromptInputHandle>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationBusyId, setConfirmationBusyId] = useState<string | null>(
    null,
  );
  const rawThreads = useQuery(operatorAgentApi.listThreads, {
    limit: 40,
    archived: false,
  });
  const threads = useMemo(
    () => normalizeOperatorAgentThreads(rawThreads),
    [rawThreads],
  );
  const activeThreadId = threadId ?? controller?.activeThreadId ?? null;
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
  const registerUpload = useMutation(operatorAgentApi.registerUpload);
  const discardUploads = useMutation(operatorAgentApi.discardUploads);
  const sendMessage = useMutation(operatorAgentApi.sendMessage);
  const cancelRun = useMutation(operatorAgentApi.cancelRun);
  const confirmAction = useMutation(operatorAgentApi.confirmAction);
  const fallbackPageContext = useMemo(
    () => operatorPageContextFromPathname(pathname),
    [pathname],
  );
  const currentPageContext =
    variant === "rail" ? (registeredPageContext ?? fallbackPageContext) : null;
  const recentContextThreads = useMemo(
    () =>
      currentPageContext
        ? threads.filter(
            (thread) =>
              thread.initialContext &&
              operatorPageContextsShareScope(
                thread.initialContext,
                currentPageContext,
              ),
          )
        : threads,
    [currentPageContext, threads],
  );
  const currentPageContextKey = currentPageContext
    ? operatorPageContextKey(currentPageContext)
    : null;
  const availablePageContext =
    currentPageContext &&
    currentPageContextKey !== controller?.detachedPageContextKey
      ? currentPageContext
      : null;
  const activeThread =
    detail.thread ??
    threads.find((thread) => thread.id === activeThreadId) ??
    null;
  const retainedThreadContext = activeThread?.initialContext ?? null;
  const displayedPageContext = retainedThreadContext ?? availablePageContext;
  const running = detail.activeRun || submitting;

  useEffect(() => {
    if (
      threadId ||
      !controller ||
      controller.activeThreadId ||
      threads.length === 0
    )
      return;
    controller.setActiveThreadId(threads[0].id);
  }, [controller, threadId, threads]);

  const startNewThread = useCallback(async () => {
    if (!controller) throw new Error("Operator agent is unavailable");
    const result = await createThread(
      availablePageContext ? { initialContext: availablePageContext } : {},
    );
    const newThreadId = result;
    controller.setActiveThreadId(newThreadId);
    return newThreadId;
  }, [availablePageContext, controller, createThread]);

  const startNewThreadFromUi = useCallback(async () => {
    try {
      await startNewThread();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a task",
      );
    }
  }, [startNewThread]);

  const submit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((!text && message.files.length === 0) || !controller || submitting)
        return;
      setSubmitting(true);
      const uploadedIntents: Array<{
        uploadIntentId: Id<"operatorAgentUploadIntents">;
        fileId?: Id<"_storage">;
      }> = [];
      try {
        const targetThreadId = activeThreadId ?? (await startNewThread());
        const attachments = await uploadPromptFiles(
          message.files,
          generateUploadUrl,
          {
            failOnUploadError: true,
            maxAggregateSize: OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES,
            onUploadTarget: (target) => {
              if (typeof target !== "string") {
                uploadedIntents.push({
                  uploadIntentId: target.uploadIntentId,
                });
              }
            },
            onUploaded: (attachment) => {
              if (attachment.uploadIntentId) {
                const tracked = uploadedIntents.find(
                  ({ uploadIntentId }) =>
                    uploadIntentId === attachment.uploadIntentId,
                );
                if (tracked) tracked.fileId = attachment.fileId;
              }
            },
            finalizeUpload: async (attachment) => {
              if (!attachment.uploadIntentId) {
                throw new Error("Operator attachment upload intent is missing");
              }
              await registerUpload({
                uploadIntentId: attachment.uploadIntentId,
                fileId: attachment.fileId,
              });
            },
          },
        );
        if (attachments.length !== message.files.length) {
          throw new Error("One or more files could not be uploaded");
        }
        await sendMessage({
          threadId: targetThreadId,
          content: text || "(attached files)",
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(!retainedThreadContext && availablePageContext
            ? { pageContext: availablePageContext }
            : {}),
        });
      } catch (error) {
        if (uploadedIntents.length > 0) {
          await discardUploads({ uploads: uploadedIntents }).catch(
            () => undefined,
          );
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "The operator task could not be sent",
        );
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [
      activeThreadId,
      availablePageContext,
      controller,
      generateUploadUrl,
      registerUpload,
      discardUploads,
      sendMessage,
      startNewThread,
      submitting,
      retainedThreadContext,
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
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col bg-background",
        variant === "rail" && "border-l border-border",
      )}
      style={
        variant === "rail"
          ? { paddingTop: "env(safe-area-inset-top, 0px)" }
          : undefined
      }
    >
      {showHeader ? (
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
                ) : recentContextThreads.length === 0 ? (
                  <DropdownMenuItem disabled className="py-3">
                    No tasks for this page.
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuRadioGroup
                    value={activeThreadId}
                    onValueChange={(threadId) => {
                      if (typeof threadId !== "string") return;
                      controller.setActiveThreadId(threadId);
                    }}
                  >
                    {recentContextThreads.map((thread) => (
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
                              {dayjs(thread.lastMessageAt).format(
                                "MMM D, h:mm A",
                              )}
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
            onClick={() => void startNewThreadFromUi()}
          >
            <Plus className="size-4" />
          </PillButton>
        </header>
      ) : null}

      {variant === "rail" && (retainedThreadContext || currentPageContext) ? (
        <div className="flex min-h-10 shrink-0 items-center border-b border-border px-3 py-1.5">
          {displayedPageContext ? (
            <div
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-full border border-input px-2.5 py-1 text-muted-foreground",
                typeStyle("label.tag"),
              )}
            >
              <span className="truncate">
                {retainedThreadContext ? "Thread context: " : "Using "}
                {operatorPageContextLabel(displayedPageContext)}
              </span>
              {!retainedThreadContext ? (
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
              ) : null}
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

      <OperatorConversation
        variant={variant}
        activeThreadId={activeThreadId}
        loading={Boolean(activeThreadId && rawThread === undefined)}
        detail={detail}
        contextual={Boolean(displayedPageContext)}
        confirmationBusyId={confirmationBusyId}
        onSelectPrompt={(prompt) => promptRef.current?.setValueAndFocus(prompt)}
        onDecision={(confirmation, decision) =>
          void decide(confirmation, decision)
        }
        composer={
          <SpotPromptInput
            ref={promptRef}
            onSubmit={submit}
            onStop={() => void stop()}
            placeholder="Ask the operator agent…"
            attachmentAccept={OPERATOR_ATTACHMENT_ACCEPT}
            multipleAttachments
            maxFiles={OPERATOR_ATTACHMENT_MAX_FILES}
            maxFileSize={OPERATOR_ATTACHMENT_MAX_BYTES}
            onAttachmentError={(message) => toast.error(message)}
            status={running ? "submitted" : undefined}
            submittedLabel="Working"
          />
        }
      />

      {pagePanel ? (
        <div className="absolute inset-0 z-10 bg-background">{pagePanel}</div>
      ) : null}
    </div>
  );
}
