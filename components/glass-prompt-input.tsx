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
import {
  ArrowUp,
  ClipboardList,
  FileText,
  Inbox,
  Paperclip,
  Square,
  X,
} from "lucide-react";
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
import { BrandIcon } from "@/components/ui/brand-icon";
import type { ChatStatus } from "ai";
import { useCachedAgentTargets } from "@/lib/sync/glass-cached-queries";

const lightInputOverlayFadeStyle = {
  backgroundImage:
    "linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.4) 55%, rgba(255, 255, 255, 0.8) 100%)",
} satisfies React.CSSProperties;

const darkInputOverlayFadeStyle = {
  backgroundImage:
    "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.4) 55%, rgba(0, 0, 0, 0.8) 100%)",
} satisfies React.CSSProperties;

const INPUT_INTENT_RADIUS = 180;
const INPUT_INTENT_EPSILON = 0.01;
const PREPARED_ACTION_INTENT_THRESHOLD = 0.34;

function InputOverlayFade() {
  return (
    <>
      <div
        className="h-16 dark:hidden"
        style={lightInputOverlayFadeStyle}
      />
      <div
        className="hidden h-16 dark:block"
        style={darkInputOverlayFadeStyle}
      />
    </>
  );
}

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

function attachmentKindLabel(file: { filename?: string; mediaType?: string }) {
  const mediaType = file.mediaType?.toLowerCase() ?? "";
  const filename = file.filename?.toLowerCase() ?? "";
  if (mediaType.includes("pdf") || filename.endsWith(".pdf")) return "PDF";
  if (
    mediaType.includes("spreadsheet") ||
    mediaType.includes("csv") ||
    filename.endsWith(".csv") ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls")
  ) {
    return "Spreadsheet";
  }
  if (
    mediaType.includes("word") ||
    filename.endsWith(".doc") ||
    filename.endsWith(".docx")
  ) {
    return "Document";
  }
  if (mediaType.startsWith("image/")) return "Image";
  if (filename.endsWith(".eml") || filename.endsWith(".msg")) return "Email";
  return "Attachment";
}

function AttachmentTags({
  roomyOnMobile = false,
  detailed = false,
}: {
  roomyOnMobile?: boolean;
  detailed?: boolean;
}) {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "order-first flex w-full flex-wrap justify-start self-start gap-2",
        roomyOnMobile ? "px-4 sm:px-3 pt-3 pb-0" : "px-3 pt-3 pb-0",
      )}
    >
      {attachments.files.map((file) => (
        <span
          key={file.id}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 bg-foreground/5 text-label font-medium text-foreground/75",
            detailed ? "rounded-lg px-2.5 py-1.5" : "rounded-full px-2.5 py-1",
          )}
        >
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span
              className="block max-w-45 truncate sm:max-w-60"
              title={file.filename}
            >
              {file.filename}
            </span>
            {detailed ? (
              <span className="block text-[11px] leading-3 text-muted-foreground/45">
                {attachmentKindLabel(file)}
              </span>
            ) : null}
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
type PromptTargetKind = PromptReference["kind"];

type PromptTrigger = {
  marker: "@" | "/";
  query: string;
  start: number;
  end: number;
  preparedKinds?: PromptTargetKind[];
};

type MentionTarget = PromptReference & {
  sublabel?: string;
};

const PREPARED_POLICY_TARGET_KINDS: PromptTargetKind[] = ["policy", "quote"];
const PREPARED_REQUIREMENT_TARGET_KINDS: PromptTargetKind[] = ["requirement"];
const PREPARED_MAILBOX_TARGET_KINDS: PromptTargetKind[] = ["mailbox"];

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
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-label font-medium text-foreground/75"
        >
          <span className="text-muted-foreground/45">
            {reference.kind === "mailbox" ? "/" : "@"}
          </span>
          <span
            className="max-w-45 truncate sm:max-w-60"
            title={reference.label}
          >
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

function PreparedInputActions({
  visible,
  showAttach,
  hasPolicyTargets,
  hasRequirementTargets,
  hasMailboxTargets,
  onOpenTargetPicker,
  variant = "compact",
}: {
  visible: boolean;
  showAttach: boolean;
  hasPolicyTargets: boolean;
  hasRequirementTargets: boolean;
  hasMailboxTargets: boolean;
  onOpenTargetPicker: (marker: "@" | "/", kinds: PromptTargetKind[]) => void;
  variant?: "compact" | "detailed";
}) {
  const attachments = usePromptInputAttachments();
  const isDetailed = variant === "detailed";

  const actions: Array<{
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    onSelect: () => void;
  }> = [];

  if (hasPolicyTargets) {
    actions.push({
      id: "policy",
      label: "Policy",
      description: "Reference policy or quote records",
      icon: <FileText className="h-3.5 w-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("@", PREPARED_POLICY_TARGET_KINDS);
      },
    });
  }

  if (hasRequirementTargets) {
    actions.push({
      id: "requirement",
      label: "Requirement",
      description: "Reference active insurance requirements",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("@", PREPARED_REQUIREMENT_TARGET_KINDS);
      },
    });
  }

  if (hasMailboxTargets) {
    actions.push({
      id: "mailbox",
      label: "Mailbox",
      description: "Search a connected email inbox",
      icon: <Inbox className="h-3.5 w-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("/", PREPARED_MAILBOX_TARGET_KINDS);
      },
    });
  }

  if (showAttach) {
    actions.push({
      id: "attach",
      label: isDetailed ? "Attach files" : "Attach",
      description: "PDFs, policies, requirements",
      icon: <Paperclip className="h-3.5 w-3.5" />,
      onSelect: () => {
        attachments.openFileDialog();
      },
    });
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Prepared prompt actions"
      aria-hidden={!visible}
      data-glass-prepared-actions
      className={cn(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,transform,margin] duration-0 ease-linear",
        visible
          ? isDetailed
            ? "mr-2 max-w-[min(42rem,100%)] translate-y-0 opacity-100"
            : "mr-1 max-w-[min(24rem,100%)] translate-y-0 opacity-100"
          : "mr-0 max-w-0 -translate-y-0.5 opacity-0 pointer-events-none",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          isDetailed ? "gap-1.5" : "gap-1",
        )}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            tabIndex={visible ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              action.onSelect();
            }}
            className={cn(
              "inline-flex shrink-0 items-center border border-foreground/8 bg-card text-left font-medium text-muted-foreground/70 transition-colors duration-0 ease-linear hover:border-foreground/14 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/10",
              isDetailed
                ? "h-11 gap-2 rounded-lg px-3"
                : "h-7 gap-1.5 rounded-full px-2.5 text-label",
            )}
          >
            <span className="shrink-0">{action.icon}</span>
            {isDetailed ? (
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-label text-foreground/75">
                  {action.label}
                </span>
                <span className="block max-w-44 truncate text-[11px] leading-3 text-muted-foreground/45">
                  {action.description}
                </span>
              </span>
            ) : (
              <span className="hidden sm:inline">{action.label}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function findActiveTrigger(value: string, cursor: number): PromptTrigger | null {
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
  variant?: "default" | "command";
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
    variant = "default",
    agentBranding,
  },
  ref,
) {
  const isCommandVariant = variant === "command";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [pointerIntent, setPointerIntent] = useState(0);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [activeTrigger, setActiveTrigger] = useState<PromptTrigger | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [references, setReferences] = useState<PromptReference[]>([]);
  const [pickerRect, setPickerRect] = useState<{
    left: number;
    width: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const targets = useCachedAgentTargets(orgId);

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
    const allowedKinds: PromptTargetKind[] =
      activeTrigger.preparedKinds ??
      (activeTrigger.marker === "/"
        ? PREPARED_MAILBOX_TARGET_KINDS
        : ["policy", "quote", "requirement"]);
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

  const updateTriggerFromTextarea = useCallback(
    (textarea: HTMLTextAreaElement) => {
      const trigger = findActiveTrigger(
        textarea.value,
        textarea.selectionStart,
      );
      setActiveTrigger((current) => {
        if (!trigger) return null;
        if (
          current?.preparedKinds &&
          current.marker === trigger.marker &&
          current.start === trigger.start
        ) {
          return { ...trigger, preparedKinds: current.preparedKinds };
        }
        return trigger;
      });
      setSelectedIndex(0);
    },
    [],
  );

  const setTextareaValue = useCallback(
    (next: string, cursor?: number, nextTrigger?: PromptTrigger | null) => {
      const el = textareaRef.current;
      if (!el) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (nextTrigger !== undefined) {
        setActiveTrigger(nextTrigger);
        setSelectedIndex(0);
      }
      const nextCursor = cursor ?? next.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
        if (nextTrigger !== undefined) {
          setActiveTrigger(nextTrigger);
          setSelectedIndex(0);
        } else {
          updateTriggerFromTextarea(el);
        }
      });
    },
    [updateTriggerFromTextarea],
  );

  const openPreparedTargetPicker = useCallback(
    (marker: "@" | "/", kinds: PromptTargetKind[]) => {
      const trigger: PromptTrigger = {
        marker,
        query: "",
        start: 0,
        end: marker.length,
        preparedKinds: kinds,
      };
      setTextValue(marker);
      setTextareaValue(marker, marker.length, trigger);
    },
    [setTextareaValue],
  );

  const selectTarget = useCallback(
    (target: MentionTarget) => {
      if (!activeTrigger) return;
      const marker = target.kind === "mailbox" ? "/" : "@";
      const replacement = `${marker}${target.label} `;
      const nextText =
        textValue.slice(0, activeTrigger.start) +
        replacement +
        textValue.slice(activeTrigger.end);
      const nextCursor = activeTrigger.start + replacement.length;
      setReferences((current) => {
        if (
          current.some(
            (item) => item.kind === target.kind && item.id === target.id,
          )
        ) {
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
    },
    [activeTrigger, setTextareaValue, textValue],
  );

  const handleDragState = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (!event.dataTransfer.types.includes("Files")) {
        return false;
      }

      event.preventDefault();
      return true;
    },
    [],
  );

  const handleDragEnter = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (handleDragState(event)) {
        setIsDraggingFiles(true);
      }
    },
    [handleDragState],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (handleDragState(event)) {
        event.dataTransfer.dropEffect = "copy";
        if (!isDraggingFiles) {
          setIsDraggingFiles(true);
        }
      }
    },
    [handleDragState, isDraggingFiles],
  );

  const handleDragLeave = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }

      setIsDraggingFiles(false);
    },
    [],
  );

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
        references:
          selectedReferences.length > 0 ? selectedReferences : undefined,
      });
      setReferences([]);
      setTextValue("");
      setActiveTrigger(null);
    },
    [onSubmit, disabled, references],
  );

  const handleTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setTextValue(event.currentTarget.value);
      updateTriggerFromTextarea(event.currentTarget);
    },
    [updateTriggerFromTextarea],
  );

  const handleTextKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!activeTrigger || suggestions.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const target = suggestions[selectedIndex] ?? suggestions[0];
        if (target) selectTarget(target);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (activeTrigger.preparedKinds && textValue === activeTrigger.marker) {
          setTextValue("");
          setTextareaValue("", 0, null);
          return;
        }
        setActiveTrigger(null);
      }
    },
    [
      activeTrigger,
      suggestions,
      selectedIndex,
      selectTarget,
      setTextareaValue,
      textValue,
    ],
  );

  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onStop?.();
    },
    [onStop],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const finePointer = window.matchMedia("(pointer: fine)");
    if (!finePointer.matches) return;

    const scheduleIntentUpdate = () => {
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const point = lastPointerRef.current;
        const wrapper = wrapperRef.current;
        if (!point || !wrapper) {
          setPointerIntent(0);
          return;
        }

        const rect = wrapper.getBoundingClientRect();
        const dx = Math.max(
          rect.left - point.x,
          0,
          point.x - rect.right,
        );
        const dy = Math.max(
          rect.top - point.y,
          0,
          point.y - rect.bottom,
        );
        const distance = Math.hypot(dx, dy);
        const next = Math.max(0, 1 - distance / INPUT_INTENT_RADIUS) ** 2;
        setPointerIntent((current) =>
          Math.abs(current - next) < INPUT_INTENT_EPSILON ? current : next,
        );
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleIntentUpdate();
    };

    const clearPointerIntent = () => {
      lastPointerRef.current = null;
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      setPointerIntent(0);
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("resize", scheduleIntentUpdate);
    window.addEventListener("scroll", scheduleIntentUpdate, true);
    window.addEventListener("blur", clearPointerIntent);
    document.addEventListener("mouseleave", clearPointerIntent);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", scheduleIntentUpdate);
      window.removeEventListener("scroll", scheduleIntentUpdate, true);
      window.removeEventListener("blur", clearPointerIntent);
      document.removeEventListener("mouseleave", clearPointerIntent);
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
      }
    };
  }, []);

  const handleWrapperFocusCapture = useCallback(() => {
    setIsComposerFocused(true);
  }, []);

  const handleWrapperBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setIsComposerFocused(false);
      setActiveTrigger(null);
    },
    [],
  );
  const hasPolicyTargets =
    (targets?.policies.length ?? 0) + (targets?.quotes.length ?? 0) > 0;
  const hasRequirementTargets = (targets?.requirements.length ?? 0) > 0;
  const hasMailboxTargets = (targets?.mailboxes.length ?? 0) > 0;
  const hasPreparedActions =
    showAttach || hasPolicyTargets || hasRequirementTargets || hasMailboxTargets;
  const showPreparedActions =
    hasPreparedActions &&
    (pointerIntent >= PREPARED_ACTION_INTENT_THRESHOLD || isComposerFocused) &&
    textValue.trim().length === 0 &&
    !activeTrigger &&
    !disabled &&
    !isGenerating &&
    !isDraggingFiles;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full"
      onFocusCapture={handleWrapperFocusCapture}
      onBlurCapture={handleWrapperBlurCapture}
    >
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
          <div
            className="overflow-auto py-1"
            style={{ maxHeight: pickerRect.maxHeight }}
          >
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
                  <span className="block truncate text-base font-medium text-foreground/85">
                    {target.label}
                  </span>
                  <span className="block truncate text-label text-muted-foreground/45">
                    {referenceKindLabel(target.kind)}
                    {target.sublabel ? ` · ${target.sublabel}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-label font-medium text-muted-foreground/35">
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
          "rounded-xl border bg-card transition-[background-color,border-color,box-shadow] duration-100 overflow-hidden hover:border-foreground/14 focus-within:border-foreground/20 dark:hover:border-[#2f2f2f] dark:focus-within:border-[#3a3a3a] **:data-[slot=input-group]:!border-0 **:data-[slot=input-group]:!ring-0 **:data-[slot=input-group]:rounded-none **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:!shadow-none",
          isCommandVariant
            ? "border-foreground/10 shadow-lg shadow-black/[0.08] dark:shadow-black/30"
            : "border-foreground/6 shadow-none focus-within:shadow-none",
          isDraggingFiles && "border-primary/40 bg-primary/5",
        )}
      >
        <AttachmentTags
          roomyOnMobile={roomyOnMobile || isCommandVariant}
          detailed={isCommandVariant}
        />
        <TriggerHintTags
          references={references}
          roomyOnMobile={roomyOnMobile || isCommandVariant}
          onRemove={(index) =>
            setReferences((current) =>
              current.filter((_, itemIndex) => itemIndex !== index),
            )
          }
        />
        <PromptInputTextarea
          ref={textareaRef}
          placeholder={placeholder}
          onChange={handleTextChange}
          onKeyDown={handleTextKeyDown}
          className={
            isCommandVariant
              ? "min-h-28 text-base leading-5 px-4 pt-4 pb-2 placeholder:text-muted-foreground/40"
              : roomyOnMobile
              ? "min-h-22 sm:min-h-5.5 text-base leading-6 sm:leading-5 px-4 sm:px-3 pt-3 sm:pt-2.5 pb-2 sm:pb-1 placeholder:text-muted-foreground/40"
              : "min-h-5.5 text-base leading-5 px-3 pt-2.5 pb-1 placeholder:text-muted-foreground/40"
          }
        />

        <PromptInputFooter
          className={
            isCommandVariant
              ? "overflow-hidden px-3 pb-3 pt-1"
              : roomyOnMobile
              ? "overflow-hidden px-3 sm:px-2 pb-2 sm:pb-1.5 pt-0.5 sm:pt-0"
              : "overflow-hidden px-2 pb-1.5 pt-0"
          }
        >
          <PromptInputTools className="min-w-0 flex-1 overflow-hidden">
            <PreparedInputActions
              visible={showPreparedActions}
              showAttach={showAttach}
              hasPolicyTargets={hasPolicyTargets}
              hasRequirementTargets={hasRequirementTargets}
              hasMailboxTargets={hasMailboxTargets}
              onOpenTargetPicker={openPreparedTargetPicker}
              variant={isCommandVariant ? "detailed" : "compact"}
            />
            <div
              className={cn(
                "flex min-w-0 items-center gap-1.5 overflow-hidden transition-[max-width,opacity,transform,margin] duration-0 ease-linear",
                showPreparedActions
                  ? "ml-0 max-w-0 -translate-y-0.5 opacity-0 pointer-events-none"
                  : roomyOnMobile
                    ? "ml-1.5 max-w-96 translate-y-0 opacity-100 sm:ml-1"
                    : "ml-1 max-w-96 translate-y-0 opacity-100",
              )}
            >
              {agentBranding?.iconUrl ? (
                <BrandIcon
                  src={agentBranding.iconUrl}
                  name={agentBranding.name}
                  size="xs"
                  className="rounded-sm"
                />
              ) : (
                <LogoIcon
                  size={14}
                  color="#A0D2FA"
                  static
                  className="shrink-0"
                />
              )}
              <span className="hidden min-w-0 truncate sm:inline text-label font-medium text-muted-foreground/40">
                {agentBranding?.name ?? "Glass"}
              </span>
              {contextLabel && (
                <span
                  className="min-w-0 max-w-50 truncate rounded bg-foreground/3 px-1.5 py-0.5 text-label font-medium text-muted-foreground/30"
                  title={contextLabel}
                >
                  {contextLabel}
                </span>
              )}
            </div>
          </PromptInputTools>

          <PromptInputTools className="shrink-0">
            <div className="flex items-center gap-1">
              {showAttach && <AttachmentActionButtons />}
              {isGenerating && onStop ? (
                <PillButton
                  type="button"
                  size="compact"
                  onClick={handleStopClick}
                  className={
                    roomyOnMobile
                      ? "h-9 px-4 text-label sm:h-7 sm:px-3 sm:text-label"
                      : undefined
                  }
                >
                  <Square
                    className={
                      roomyOnMobile
                        ? "h-3.5 w-3.5 fill-current sm:h-3 sm:w-3"
                        : "h-3 w-3 fill-current"
                    }
                  />
                  Stop
                </PillButton>
              ) : (
                <PillButton
                  type="submit"
                  size="compact"
                  disabled={disabled || isGenerating}
                  className={
                    roomyOnMobile
                      ? "h-9 px-4 text-label sm:h-7 sm:px-3 sm:text-label"
                      : undefined
                  }
                >
                  {status === "submitted" ? (
                    <>
                      <Spinner
                        className={
                          roomyOnMobile
                            ? "h-4 w-4 sm:h-3.5 sm:w-3.5"
                            : "h-3.5 w-3.5"
                        }
                      />
                      {submittedLabel}
                    </>
                  ) : (
                    <>
                      <ArrowUp
                        className={
                          roomyOnMobile
                            ? "h-4 w-4 sm:h-3.5 sm:w-3.5"
                            : "h-3.5 w-3.5"
                        }
                      />
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
      <InputOverlayFade />
      <div
        className="pointer-events-auto px-4 pt-2 md:px-6 lg:px-8"
        style={{
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="max-w-2xl mx-auto">{children}</div>
      </div>
    </div>
  );
}
