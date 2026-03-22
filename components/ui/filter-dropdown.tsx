"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";

interface FilterDropdownProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel =
    options.find((o) => o.value === value)?.label || label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-body-sm font-medium transition-all cursor-pointer max-w-[200px] ${
          value
            ? "border-foreground/15 bg-foreground/5 text-foreground"
            : "border-foreground/8 bg-white/80 dark:bg-white/[0.06] text-muted-foreground hover:border-foreground/15 hover:text-foreground/80"
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1.5 left-0 min-w-[160px] max-w-[240px] rounded-lg border border-foreground/6 bg-popover/90 backdrop-blur-xl shadow-lg shadow-black/[0.08] py-1 z-50"
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-body-sm transition-colors cursor-pointer ${
                !value
                  ? "text-foreground bg-foreground/[0.03]"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
              }`}
            >
              <span className="truncate">{label}</span>
              {!value && <Check className="w-3 h-3 shrink-0" />}
            </button>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-body-sm transition-colors cursor-pointer ${
                  value === option.value
                    ? "text-foreground bg-foreground/[0.03]"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {value === option.value && <Check className="w-3 h-3 shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
