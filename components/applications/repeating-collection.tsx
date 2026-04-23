"use client";

import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

export function RepeatingItemCard({
  title,
  onRemove,
  removeAriaLabel,
  children,
}: {
  title: string;
  onRemove?: () => void;
  removeAriaLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative space-y-4 rounded-xl border border-foreground/8 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeAriaLabel ?? "Remove"}
            className="p-1 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function AddItemButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 text-sm font-medium text-foreground hover:opacity-70 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}

export function RepeatingCollectionShell({
  label,
  children,
  addButton,
}: {
  label: string;
  children: ReactNode;
  addButton?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-label-sm font-medium text-muted-foreground">{label}</p>
      {children}
      {addButton}
    </div>
  );
}
