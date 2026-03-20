"use client";

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { ArrowUp, Plus, Paperclip, Loader2, Asterisk } from "lucide-react";

export interface ChatInputHandle {
  /** Set the input value and focus the textarea */
  setValueAndFocus: (value: string) => void;
}

export interface ChatInputProps {
  /** Called when user submits. Return a promise that resolves when done. */
  onSend: (content: string, files?: File[]) => Promise<void>;
  placeholder?: string;
  /** Optional context pill label (e.g. "Policies", "Dashboard") */
  contextLabel?: string;
  /** Show the attach/upload button */
  showAttach?: boolean;
  /** Externally controlled disabled state */
  disabled?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  placeholder = "Ask Clarity...",
  contextLabel,
  showAttach = true,
  disabled = false,
  autoFocus = false,
}, ref) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    setValueAndFocus: (v: string) => {
      setValue(v);
      textareaRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = "22px";
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if ((!text && pendingFiles.length === 0) || sending || disabled) return;

    setSending(true);
    const filesToSend = [...pendingFiles];
    setValue("");
    setPendingFiles([]);
    resetHeight();

    try {
      await onSend(text, filesToSend.length > 0 ? filesToSend : undefined);
    } catch {
      // Restore on error
      setValue(text);
      setPendingFiles(filesToSend);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [value, pendingFiles, sending, disabled, onSend, resetHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = (value.trim() || pendingFiles.length > 0) && !sending && !disabled;

  return (
    <div className="w-full">
      {/* Pending file chips */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingFiles.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-foreground/[0.04] text-[11px] text-foreground/70"
            >
              <Paperclip className="w-3 h-3 text-muted-foreground/40" />
              <span className="truncate max-w-[140px]">{f.name}</span>
              <button
                type="button"
                onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
              >
                <span className="sr-only">Remove</span>&times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input container */}
      <div className="rounded-xl border border-foreground/8 bg-white focus-within:border-foreground/15 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all">
        {/* Row 1: textarea */}
        <div className="px-3 pt-2.5 pb-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none text-body-sm leading-5 bg-transparent outline-none placeholder:text-muted-foreground/40 min-w-0"
            style={{ maxHeight: "120px", height: "22px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
        </div>

        {/* Row 2: actions */}
        <div className="flex items-center justify-between px-2 pb-1.5 pt-0">
          {/* Left side */}
          <div className="flex items-center gap-1.5 ml-1">
            <Asterisk className="w-3.5 h-3.5 text-[#A0D2FA]" />
            <span className="hidden sm:inline text-[11px] font-medium text-muted-foreground/40">Clarity Agent</span>
            {contextLabel && (
              <span className="text-[10px] font-medium text-muted-foreground/30 bg-foreground/[0.03] px-1.5 py-0.5 rounded">
                {contextLabel}
              </span>
            )}
          </div>

          {/* Right side */}
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
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
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
    </div>
  );
});

/**
 * Wrapper that adds the overlay footer layout with gradient fade.
 * Used for chat pages where the input sits at the bottom over scrollable content.
 */
export function ChatInputOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div
        className="h-16"
        style={{
          background:
            "linear-gradient(to bottom, rgba(250,248,244,0) 0%, rgba(250,248,244,0.4) 50%, rgba(250,248,244,0.8) 100%)",
        }}
      />
      <div className="pointer-events-auto bg-[rgba(250,248,244,0.8)] px-4 md:px-6 lg:px-8 pt-2" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="max-w-2xl mx-auto">{children}</div>
      </div>
    </div>
  );
}
