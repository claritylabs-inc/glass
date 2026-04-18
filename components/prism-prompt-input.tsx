"use client";

import {
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { ArrowUp, Asterisk, Paperclip, Square, X } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import type { ChatStatus } from "ai";

// Inner component — must render inside <PromptInput> to access LocalAttachmentsContext
function AttachmentActionButtons() {
  const attachments = usePromptInputAttachments();

  const handleAttach = useCallback(() => {
    attachments.openFileDialog();
  }, [attachments]);

  return (
    <>
      <PillButton
        type="button"
        size="compact"
        variant="icon"
        onClick={handleAttach}
        title="Add photos or files"
        aria-label="Add photos or files"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </PillButton>
    </>
  );
}

function AttachmentTags({ roomyOnMobile = false }: { roomyOnMobile?: boolean }) {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      "order-first flex w-full flex-wrap justify-start self-start gap-2",
      roomyOnMobile ? "px-4 sm:px-3 pt-3 pb-0" : "px-3 pt-3 pb-0"
    )}>
      {attachments.files.map((file) => (
        <span
          key={file.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/75"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="max-w-[180px] truncate sm:max-w-[240px]" title={file.filename}>
            {file.filename}
          </span>
          <button
            type="button"
            onClick={() => attachments.remove(file.id)}
            title={`Remove ${file.filename}`}
            className="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export interface PrismPromptInputHandle {
  setValueAndFocus: (value: string) => void;
}

export interface PrismPromptInputProps {
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  placeholder?: string;
  contextLabel?: string;
  showAttach?: boolean;
  roomyOnMobile?: boolean;
  disabled?: boolean;
  status?: ChatStatus;
  onStop?: () => void;
}

export const PrismPromptInput = forwardRef<
  PrismPromptInputHandle,
  PrismPromptInputProps
>(function PrismPromptInput(
  {
    onSubmit,
    placeholder = "Ask Prism...",
    contextLabel,
    showAttach = true,
    roomyOnMobile = false,
    disabled = false,
    status,
    onStop,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const handleDragState = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return false;
    }

    event.preventDefault();
    return true;
  }, []);

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (handleDragState(event)) {
      setIsDraggingFiles(true);
    }
  }, [handleDragState]);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (handleDragState(event)) {
      event.dataTransfer.dropEffect = "copy";
      if (!isDraggingFiles) {
        setIsDraggingFiles(true);
      }
    }
  }, [handleDragState, isDraggingFiles]);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (
      event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      return;
    }

    setIsDraggingFiles(false);
  }, []);

  const handleDrop = useCallback(() => {
    setIsDraggingFiles(false);
  }, []);

  useImperativeHandle(ref, () => ({
    setValueAndFocus: (v: string) => {
      const el = textareaRef.current;
      if (el) {
        // Set value via native setter to trigger React's onChange
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
      }
    },
  }));

  const isGenerating = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (disabled) return;
      return onSubmit(message);
    },
    [onSubmit, disabled],
  );

  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onStop?.();
    },
    [onStop],
  );

  return (
    <div className="w-full">
      <PromptInput
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "rounded-xl border border-foreground/6 bg-popover focus-within:border-foreground/15 dark:focus-within:border-[#3a3a3a] transition-all overflow-hidden [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:shadow-none",
          isDraggingFiles && "border-primary/40 bg-primary/5"
        )}
      >
        <AttachmentTags roomyOnMobile={roomyOnMobile} />
        <PromptInputTextarea
          ref={textareaRef}
          placeholder={placeholder}
          className={roomyOnMobile
            ? "min-h-[88px] sm:min-h-[22px] text-body-sm leading-6 sm:leading-5 px-4 sm:px-3 pt-3 sm:pt-2.5 pb-2 sm:pb-1 placeholder:text-muted-foreground/40"
            : "min-h-[22px] text-body-sm leading-5 px-3 pt-2.5 pb-1 placeholder:text-muted-foreground/40"
          }
        />

        <PromptInputFooter className={roomyOnMobile ? "px-3 sm:px-2 pb-2 sm:pb-1.5 pt-0.5 sm:pt-0" : "px-2 pb-1.5 pt-0"}>
          {/* Left side: branding + context */}
          <PromptInputTools>
            <div className={roomyOnMobile ? "flex items-center gap-1.5 ml-1.5 sm:ml-1" : "flex items-center gap-1.5 ml-1"}>
              <Asterisk className="w-3.5 h-3.5 text-primary-light" />
              <span className="hidden sm:inline text-[11px] font-medium text-muted-foreground/40">
                Prism
              </span>
              {contextLabel && (
                <span className="text-[10px] font-medium text-muted-foreground/30 bg-foreground/[0.03] px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block align-middle" title={contextLabel}>
                  {contextLabel}
                </span>
              )}
            </div>
          </PromptInputTools>

          {/* Right side: attach + submit */}
          <PromptInputTools>
            <div className="flex items-center gap-1">
              {showAttach && <AttachmentActionButtons />}
              {isGenerating && onStop ? (
                <PillButton
                  type="button"
                  size="compact"
                  onClick={handleStopClick}
                  className={roomyOnMobile ? "h-9 px-4 text-[12px] sm:h-7 sm:px-3 sm:text-[11px]" : undefined}
                >
                  <Square className={roomyOnMobile ? "h-3.5 w-3.5 fill-current sm:h-3 sm:w-3" : "h-3 w-3 fill-current"} />
                  Stop
                </PillButton>
              ) : (
                <PillButton
                  type="submit"
                  size="compact"
                  disabled={disabled || isGenerating}
                  className={roomyOnMobile ? "h-9 px-4 text-[12px] sm:h-7 sm:px-3 sm:text-[11px]" : undefined}
                >
                  {status === "submitted" ? (
                    <>
                      <Spinner className={roomyOnMobile ? "h-4 w-4 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} />
                      Sending
                    </>
                  ) : (
                    <>
                      <ArrowUp className={roomyOnMobile ? "h-4 w-4 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} />
                      Send
                    </>
                  )}
                </PillButton>
              )}
            </div>
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
});
