"use client";

import { useEffect, useRef, useState } from "react";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

export function EditableBreadcrumbTitle({
  title,
  saveKey,
  onSave,
  errorMessage = "The title could not be saved.",
}: {
  title: string;
  saveKey: string;
  onSave: (next: string) => Promise<void> | void;
  errorMessage?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [localTitle, setLocalTitle] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (localTitle !== title) return;
    queueMicrotask(() => setLocalTitle(null));
  }, [localTitle, title]);

  const display = localTitle ?? title;
  const autoSave = useLocalFirstAutoSave({
    mutationName: `thread.rename.${saveKey}`,
    args: { title: draft.trim() },
    resetKey: saveKey,
    autoSave: false,
    canSave: !!draft.trim(),
    flush: (args) => Promise.resolve(onSave(args.title)),
    onError: () => setLocalTitle(null),
    errorMessage,
  });

  async function commit() {
    const next = draft.trim();
    if (!next || next === display) {
      setEditing(false);
      setDraft(display);
      return;
    }
    setLocalTitle(next);
    setEditing(false);
    await autoSave.saveNow();
  }

  if (editing) {
    // Sizer in flow gives the wrapper its width; input is positioned over it.
    // Both share the exact same text-base + px/py so the input matches the
    // measured width to the pixel — no JS measurement, no flicker.
    return (
      <span className="inline-flex min-w-0 items-center gap-2 align-middle">
        <span className="relative -mx-1.5 inline-block max-w-[60vw] align-middle">
          <span
            aria-hidden
            style={{ visibility: "hidden", color: "transparent" }}
            className="pointer-events-none block select-none whitespace-pre px-1.5 py-0.5 text-base"
          >
            {(draft || " ") + "\u00A0"}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(display);
                setEditing(false);
              }
            }}
            style={{
              fontFamily: "inherit",
              fontSize: "inherit",
              fontWeight: "inherit",
              fontStyle: "inherit",
              lineHeight: "inherit",
              letterSpacing: "inherit",
            }}
            className="absolute inset-0 w-full rounded-md border-0 bg-foreground/4 px-1.5 py-0.5 text-foreground outline-none transition-colors focus:bg-foreground/6"
          />
        </span>
        <AutoSaveStatus status={autoSave.status} className="min-w-0" />
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2 align-middle">
      <button
        type="button"
        onClick={() => {
          setDraft(display);
          setEditing(true);
        }}
        title="Rename"
        className="-mx-1.5 max-w-[60vw] cursor-text truncate rounded-md px-1.5 py-0.5 text-left text-base text-foreground transition-colors hover:bg-foreground/4"
      >
        {display}
      </button>
      <AutoSaveStatus status={autoSave.status} className="min-w-0" />
    </span>
  );
}
