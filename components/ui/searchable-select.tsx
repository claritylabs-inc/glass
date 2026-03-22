"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

interface SearchableSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  const filtered = search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, handleClose]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        disabled={disabled}
        className="w-full flex items-center justify-between rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm text-left transition-colors focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <span className={selectedLabel ? "text-foreground" : "text-muted-foreground/40"}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-foreground/10 bg-popover shadow-md overflow-hidden">
          <div className="p-1.5 border-b border-foreground/6">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-6.5 pr-2 py-1.5 text-body-sm rounded-md bg-foreground/[0.03] placeholder:text-muted-foreground/40 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleClose();
                  if (e.key === "Enter" && filtered.length === 1) {
                    onChange(filtered[0].value);
                    handleClose();
                  }
                }}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-label-sm text-muted-foreground/50">
                No results
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    handleClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-body-sm text-left hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.value === value && (
                    <Check className="w-3 h-3 text-foreground shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
