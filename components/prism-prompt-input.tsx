"use client";

import { useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { ArrowUp, Plus, Asterisk, Square } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Spinner } from "@/components/ui/spinner";
import type { ChatStatus } from "ai";

export interface PrismPromptInputHandle {
  setValueAndFocus: (value: string) => void;
}

export interface PrismPromptInputProps {
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  placeholder?: string;
  contextLabel?: string;
  showAttach?: boolean;
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
    disabled = false,
    status,
    onStop,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        className="rounded-xl border-foreground/8 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-foreground/15 transition-all overflow-hidden [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:shadow-none"
      >
        <PromptInputTextarea
          ref={textareaRef}
          placeholder={placeholder}
          className="min-h-[22px] text-body-sm leading-5 px-3 pt-2.5 pb-1 placeholder:text-muted-foreground/40"
        />

        <PromptInputFooter className="px-2 pb-1.5 pt-0">
          {/* Left side: branding + context */}
          <PromptInputTools>
            <div className="flex items-center gap-1.5 ml-1">
              <Asterisk className="w-3.5 h-3.5 text-[#A0D2FA]" />
              <span className="hidden sm:inline text-[11px] font-medium text-muted-foreground/40">
                Prism
              </span>
              {contextLabel && (
                <span className="text-[10px] font-medium text-muted-foreground/30 bg-foreground/[0.03] px-1.5 py-0.5 rounded">
                  {contextLabel}
                </span>
              )}
            </div>
          </PromptInputTools>

          {/* Right side: attach + submit */}
          <PromptInputTools>
            <div className="flex items-center gap-1">
              {showAttach && (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                  />
                </>
              )}
              {isGenerating && onStop ? (
                <button
                  type="button"
                  onClick={handleStopClick}
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-white transition-opacity cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={disabled || isGenerating}
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-foreground text-white disabled:opacity-20 transition-opacity cursor-pointer"
                >
                  {status === "submitted" ? (
                    <Spinner className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowUp className="w-3.5 h-3.5" />
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
