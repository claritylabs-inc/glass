"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp } from "lucide-react";

type FileDropHandlers<T extends HTMLElement> = {
  onDragEnter: (e: DragEvent<T>) => void;
  onDragOver: (e: DragEvent<T>) => void;
  onDragLeave: (e: DragEvent<T>) => void;
  onDrop: (e: DragEvent<T>) => void;
};

export function useFileDrop<T extends HTMLElement = HTMLElement>(
  onFiles: (files: FileList) => void,
): { dragging: boolean; handlers: FileDropHandlers<T> } {
  const [dragging, setDragging] = useState(false);

  const handlers: FileDropHandlers<T> = {
    onDragEnter: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
    },
  };

  return { dragging, handlers };
}

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  /** Primary headline shown at rest. */
  idleLabel: ReactNode;
  /** Message while a file is being uploaded. */
  busyLabel?: ReactNode;
  /** Message while a file is hovering over the zone. */
  activeLabel?: ReactNode;
  /** Secondary text below the headline. Defaults to "or click to choose a file". */
  hint?: ReactNode;
  /** Tailwind padding override for the zone. */
  padding?: string;
  className?: string;
}

export function FileDropZone({
  onFile,
  accept = "application/pdf,.pdf",
  disabled = false,
  idleLabel,
  busyLabel,
  activeLabel,
  hint = "or click to choose a file",
  padding = "px-6 py-8",
  className = "",
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { dragging, handlers } = useFileDrop<HTMLButtonElement>((files) => {
    const file = files[0];
    if (file) onFile(file);
  });

  const label = disabled
    ? busyLabel ?? idleLabel
    : dragging
      ? activeLabel ?? idleLabel
      : idleLabel;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        {...handlers}
        className={`w-full rounded-lg border border-dashed ${padding} text-center transition-colors ${
          dragging
            ? "border-primary/40 bg-primary/[0.03]"
            : "border-foreground/10 hover:border-foreground/20 hover:bg-foreground/[0.01]"
        } ${disabled ? "opacity-70 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.04]">
          <FileUp className="h-5 w-5 text-foreground/70" />
        </div>
        <p className="text-body-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-1 text-label-sm text-muted-foreground">{hint}</p>}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}
