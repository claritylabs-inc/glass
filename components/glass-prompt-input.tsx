"use client";

import {
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { ArrowUp, ClipboardList, FileText, Inbox, Paperclip, Square, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { LogoIcon } from "@/components/ui/logo-icon";
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
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-label-sm font-medium text-foreground/75"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="max-w-45 truncate sm:max-w-60" title={file.filename}>
            {file.filename}
          </span>
          <button
            type="button"
            onClick={() => attachments.remove(file.id)}
            title={`Remove ${file.filename}`}
            className="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

type PromptReference = NonNullable<PromptInputMessage["references"]>[number];

type MentionTarget = PromptReference & {
  sublabel?: string;
};

function referenceIcon(kind: PromptReference["kind"]) {
  if (kind === "requirement") return <ClipboardList className="h-3.5 w-3.5" />;
  if (kind === "mailbox") return <Inbox className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function referenceKindLabel(kind: PromptReference["kind"]) {
  if (kind === "policy") return "Policy";
  if (kind === "quote") return "Quote";
  if (kind === "requirement") return "Requirement";
  return "Mailbox";
}

function TriggerHintTags({
  references,
  onRemove,
  roomyOnMobile = false,
}: {
  references: PromptReference[];
  onRemove: (index: number) => void;
  roomyOnMobile?: boolean;
}) {
  if (references.length === 0) return null;

  return (
    <div
      className={cn(
        "order-first flex w-full flex-wrap justify-start self-start gap-2",
        roomyOnMobile ? "px-4 sm:px-3 pt-3 pb-0" : "px-3 pt-3 pb-0",
      )}
    >
      {references.map((reference, index) => (
        <span
          key={`${reference.kind}-${reference.id}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-label-sm font-medium text-foreground/75"
        >
          <span className="text-muted-foreground">{referenceIcon(reference.kind)}</span>
          <span className="text-muted-foreground/45">
            {reference.kind === "mailbox" ? "/" : "@"}
          </span>
          <span className="max-w-45 truncate sm:max-w-60" title={reference.label}>
            {reference.label}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            title={`Remove ${reference.label}`}
            className="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function findActiveTrigger(value: string, cursor: number) {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)([@/])([^\s@/]*)$/);
  if (!match) return null;
  const marker = match[2] as "@" | "/";
  const query = match[3] ?? "";
  return {
    marker,
    query,
    start: prefix.length - marker.length - query.length,
    end: cursor,
  };
}

export interface GlassPromptInputHandle {
  setValueAndFocus: (value: string) => void;
}

export interface GlassPromptInputProps {
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  placeholder?: string;
  contextLabel?: string;
  showAttach?: boolean;
  roomyOnMobile?: boolean;
  disabled?: boolean;
  status?: ChatStatus;
  submittedLabel?: string;
  onStop?: () => void;
  orgId?: Id<"organizations">;
  /** Override the default "Glass" branding shown in the footer. */
  agentBranding?: { name: string; iconUrl?: string | null };
}

export const GlassPromptInput = forwardRef<
  GlassPromptInputHandle,
  GlassPromptInputProps
>(function GlassPromptInput(
  {
    onSubmit,
    placeholder = "Ask Glass...",
    contextLabel,
    showAttach = true,
    roomyOnMobile = false,
    disabled = false,
    status,
    submittedLabel = "Sending",
    onStop,
    orgId,
    agentBranding,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [activeTrigger, setActiveTrigger] = useState<ReturnType<typeof findActiveTrigger>>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [references, setReferences] = useState<PromptReference[]>([]);
  const [pickerRect, setPickerRect] = useState<{
    left: number;
    width: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const targets = useQuery(api.agentTargets.list, orgId ? { orgId } : "skip");

  const mentionTargets = useMemo<MentionTarget[]>(() => {
    if (!targets) return [];
    return [
      ...targets.policies,
      ...targets.quotes,
      ...targets.requirements,
      ...targets.mailboxes,
    ].map((target) => ({
      kind: target.kind,
      id: target.id,
      label: target.label,
      sublabel: target.sublabel,
    }));
  }, [targets]);

  const suggestions = useMemo(() => {
    if (!activeTrigger) return [];
    const allowedKinds: PromptReference["kind"][] =
      activeTrigger.marker === "/"
        ? ["mailbox"]
        : ["policy", "quote", "requirement"];
    const query = activeTrigger.query.toLowerCase();
    return mentionTargets
      .filter((target) => allowedKinds.includes(target.kind))
      .filter((target) => {
        if (!query) return true;
        return `${target.label} ${target.sublabel ?? ""} ${target.kind}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 8);
  }, [activeTrigger, mentionTargets]);

  const updatePickerRect = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !activeTrigger || suggestions.length === 0) {
      setPickerRect(null);
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const gap = 8;
    const topPadding = 16;
    setPickerRect({
      left: rect.left,
      width: rect.width,
      bottom: Math.max(0, window.innerHeight - rect.top + gap),
      maxHeight: Math.max(120, rect.top - topPadding - gap),
    });
  }, [activeTrigger, suggestions.length]);

  useEffect(() => {
    updatePickerRect();
  }, [updatePickerRect, textValue, references.length]);

  useEffect(() => {
    if (!activeTrigger || suggestions.length === 0) return;
    window.addEventListener("resize", updatePickerRect);
    window.addEventListener("scroll", updatePickerRect, true);
    return () => {
      window.removeEventListener("resize", updatePickerRect);
      window.removeEventListener("scroll", updatePickerRect, true);
    };
  }, [activeTrigger, suggestions.length, updatePickerRect]);

  const updateTriggerFromTextarea = useCallback((textarea: HTMLTextAreaElement) => {
    const trigger = findActiveTrigger(textarea.value, textarea.selectionStart);
    setActiveTrigger(trigger);
    setSelectedIndex(0);
  }, []);

  const setTextareaValue = useCallback((next: string, cursor?: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const nextCursor = cursor ?? next.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      updateTriggerFromTextarea(el);
    });
  }, [updateTriggerFromTextarea]);

  const selectTarget = useCallback((target: MentionTarget) => {
    if (!activeTrigger) return;
    const marker = target.kind === "mailbox" ? "/" : "@";
    const replacement = `${marker}${target.label} `;
    const nextText =
      textValue.slice(0, activeTrigger.start) +
      replacement +
      textValue.slice(activeTrigger.end);
    const nextCursor = activeTrigger.start + replacement.length;
    setReferences((current) => {
      if (current.some((item) => item.kind === target.kind && item.id === target.id)) {
        return current;
      }
      return [
        ...current,
        { kind: target.kind, id: target.id, label: target.label },
      ];
    });
    setTextValue(nextText);
    setActiveTrigger(null);
    setTextareaValue(nextText, nextCursor);
  }, [activeTrigger, setTextareaValue, textValue]);

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
        setTextValue(v);
        setActiveTrigger(null);
      }
    },
  }));

  const isGenerating = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (disabled) return;
      const selectedReferences = references;
      await onSubmit({
        ...message,
        references: selectedReferences.length > 0 ? selectedReferences : undefined,
      });
      setReferences([]);
      setTextValue("");
      setActiveTrigger(null);
    },
    [onSubmit, disabled, references],
  );

  const handleTextChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextValue(event.currentTarget.value);
    updateTriggerFromTextarea(event.currentTarget);
  }, [updateTriggerFromTextarea]);

  const handleTextKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeTrigger || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const target = suggestions[selectedIndex] ?? suggestions[0];
      if (target) selectTarget(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setActiveTrigger(null);
    }
  }, [activeTrigger, suggestions, selectedIndex, selectTarget]);

  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onStop?.();
    },
    [onStop],
  );

  return (
    <div ref={wrapperRef} className="relative w-full">
      {activeTrigger && suggestions.length > 0 && pickerRect ? (
        <div
          className="fixed z-50 overflow-hidden rounded-lg border border-foreground/8 bg-popover shadow-lg"
          style={{
            left: pickerRect.left,
            width: pickerRect.width,
            bottom: pickerRect.bottom,
            maxHeight: pickerRect.maxHeight,
          }}
        >
          <div className="overflow-auto py-1" style={{ maxHeight: pickerRect.maxHeight }}>
            {suggestions.map((target, index) => (
              <button
                key={`${target.kind}-${target.id}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectTarget(target);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                  index === selectedIndex
                    ? "bg-foreground/[0.06]"
                    : "hover:bg-foreground/[0.04]",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
                  {referenceIcon(target.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground/85">
                    {target.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground/45">
                    {referenceKindLabel(target.kind)}
                    {target.sublabel ? ` · ${target.sublabel}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground/35">
                  {target.kind === "mailbox" ? "/" : "@"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <PromptInput
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "rounded-xl border border-foreground/6 bg-card shadow-none transition-all overflow-hidden hover:border-foreground/14 hover:bg-foreground/1 focus-within:border-foreground/20 focus-within:bg-card focus-within:shadow-none dark:hover:border-[#2f2f2f] dark:focus-within:border-[#3a3a3a] **:data-[slot=input-group]:!border-0 **:data-[slot=input-group]:!ring-0 **:data-[slot=input-group]:rounded-none **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:!shadow-none",
          isDraggingFiles && "border-primary/40 bg-primary/5"
        )}
      >
        <AttachmentTags roomyOnMobile={roomyOnMobile} />
        <TriggerHintTags
          references={references}
          roomyOnMobile={roomyOnMobile}
          onRemove={(index) =>
            setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }
        />
        <PromptInputTextarea
          ref={textareaRef}
          placeholder={placeholder}
          onChange={handleTextChange}
          onKeyDown={handleTextKeyDown}
          className={roomyOnMobile
            ? "min-h-22 sm:min-h-5.5 text-body-sm leading-6 sm:leading-5 px-4 sm:px-3 pt-3 sm:pt-2.5 pb-2 sm:pb-1 placeholder:text-muted-foreground/40"
            : "min-h-5.5 text-body-sm leading-5 px-3 pt-2.5 pb-1 placeholder:text-muted-foreground/40"
          }
        />

        <PromptInputFooter className={roomyOnMobile ? "px-3 sm:px-2 pb-2 sm:pb-1.5 pt-0.5 sm:pt-0" : "px-2 pb-1.5 pt-0"}>
          {/* Left side: branding + context */}
          <PromptInputTools>
            <div className={roomyOnMobile ? "flex items-center gap-1.5 ml-1.5 sm:ml-1" : "flex items-center gap-1.5 ml-1"}>
              {agentBranding?.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={agentBranding.iconUrl}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm object-cover"
                />
              ) : (
                <LogoIcon size={14} color="#A0D2FA" static className="shrink-0" />
              )}
              <span className="hidden sm:inline text-label-sm font-medium text-muted-foreground/40">
                {agentBranding?.name ?? "Glass"}
              </span>
              {contextLabel && (
                <span className="text-[10px] font-medium text-muted-foreground/30 bg-foreground/3 px-1.5 py-0.5 rounded max-w-50 truncate inline-block align-middle" title={contextLabel}>
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
                  className={roomyOnMobile ? "h-9 px-4 text-label sm:h-7 sm:px-3 sm:text-label-sm" : undefined}
                >
                  <Square className={roomyOnMobile ? "h-3.5 w-3.5 fill-current sm:h-3 sm:w-3" : "h-3 w-3 fill-current"} />
                  Stop
                </PillButton>
              ) : (
                <PillButton
                  type="submit"
                  size="compact"
                  disabled={disabled || isGenerating}
                  className={roomyOnMobile ? "h-9 px-4 text-label sm:h-7 sm:px-3 sm:text-label-sm" : undefined}
                >
                  {status === "submitted" ? (
                    <>
                      <Spinner className={roomyOnMobile ? "h-4 w-4 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} />
                      {submittedLabel}
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

/**
 * Overlay footer layout for chat pages where the input sits above scrollable content.
 */
export function ChatInputOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="h-16 bg-linear-to-b from-white/0 via-white/40 to-white/80 dark:from-black/0 dark:via-black/40 dark:to-black/80" />
      <div className="pointer-events-auto bg-white/80 dark:bg-black/80 px-4 md:px-6 lg:px-8 pt-2" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="max-w-2xl mx-auto">{children}</div>
      </div>
    </div>
  );
}
