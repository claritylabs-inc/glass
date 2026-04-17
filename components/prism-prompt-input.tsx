"use client";

import { useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { ArrowUp, ImageIcon, Monitor, Asterisk, Square } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  usePromptInputAttachments,
  captureScreenshot,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Spinner } from "@/components/ui/spinner";
import type { ChatStatus } from "ai";

// Inner component — must render inside <PromptInput> to access LocalAttachmentsContext
function AttachmentActionButtons() {
  const attachments = usePromptInputAttachments();

  const handleAttach = useCallback(() => {
    attachments.openFileDialog();
  }, [attachments]);

  const handleScreenshot = useCallback(async () => {
    try {
      const screenshot = await captureScreenshot();
      if (screenshot) {
        attachments.add([screenshot]);
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        return;
      }
      throw error;
    }
  }, [attachments]);

  return (
    <>
      <button
        type="button"
        onClick={handleAttach}
        title="Add photos or files"
        className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-foreground/[0.04] transition-colors cursor-pointer"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleScreenshot}
        title="Take screenshot"
        className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-foreground/[0.04] transition-colors cursor-pointer"
      >
        <Monitor className="w-3.5 h-3.5" />
      </button>
    </>
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
        className="rounded-xl border border-foreground/6 bg-popover focus-within:border-foreground/15 dark:focus-within:border-[#3a3a3a] transition-all overflow-hidden [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:shadow-none"
      >
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
                <button
                  type="button"
                  onClick={handleStopClick}
                  className={roomyOnMobile
                    ? "w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded-md bg-foreground text-background transition-opacity cursor-pointer"
                    : "w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-background transition-opacity cursor-pointer"
                  }
                >
                  <Square className={roomyOnMobile ? "w-4 h-4 sm:w-3 sm:h-3 fill-current" : "w-3 h-3 fill-current"} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={disabled || isGenerating}
                  className={roomyOnMobile
                    ? "w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded-md bg-foreground text-background disabled:opacity-20 transition-opacity cursor-pointer"
                    : "w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-background disabled:opacity-20 transition-opacity cursor-pointer"
                  }
                >
                  {status === "submitted" ? (
                    <Spinner className={roomyOnMobile ? "w-4 h-4 sm:w-3.5 sm:h-3.5" : "w-3.5 h-3.5"} />
                  ) : (
                    <ArrowUp className={roomyOnMobile ? "w-4 h-4 sm:w-3.5 sm:h-3.5" : "w-3.5 h-3.5"} />
                  )}
                </button>
              )}
            </div>
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
});
