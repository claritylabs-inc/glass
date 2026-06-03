"use client";

import { useEffect, useRef, useState } from "react";

export function EditableBreadcrumbTitle({
  title,
  onSave,
}: {
  title: string;
  onSave: (next: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pending, setPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const display = pending ?? title;

  async function commit() {
    const next = draft.trim();
    if (!next || next === display) {
      setEditing(false);
      setDraft(display);
      return;
    }
    setPending(next);
    setEditing(false);
    try {
      await onSave(next);
    } catch {
      setPending(null);
      return;
    }
    setPending(null);
  }

  if (editing) {
    // Sizer in flow gives the wrapper its width; input is positioned over it.
    // Both share the exact same text-base + px/py so the input matches the
    // measured width to the pixel — no JS measurement, no flicker.
    return (
      <span className="relative inline-block align-middle -mx-1.5 max-w-[60vw]">
        <span
          aria-hidden
          style={{ visibility: "hidden", color: "transparent" }}
          className="whitespace-pre text-base px-1.5 py-0.5 block pointer-events-none select-none"
        >
          {(draft || " ") + "\u00A0"}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(title);
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
          className="absolute inset-0 w-full text-foreground bg-foreground/4 rounded-md outline-none border-0 px-1.5 py-0.5 focus:bg-foreground/6 transition-colors"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      title="Rename"
      className="-mx-1.5 px-1.5 py-0.5 rounded-md text-base text-foreground truncate hover:bg-foreground/4 transition-colors cursor-text text-left max-w-[60vw] align-middle"
    >
      {display}
    </button>
  );
}
