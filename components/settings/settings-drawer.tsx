"use client";

import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const EASE = [0.2, 0, 0, 1] as const;

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.08, ease: EASE }}
          className="max-lg:fixed! max-lg:inset-0! max-lg:z-50! flex h-full w-full shrink-0 overflow-hidden"
        >
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.1, ease: EASE }}
            className="flex min-h-0 w-full flex-1 flex-col border-l border-foreground/6 bg-background"
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                {title}
              </span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {children}
            </div>

            {footer && (
              <div className="border-t border-foreground/6 px-4 py-3 flex flex-col-reverse items-stretch gap-2 shrink-0 lg:flex-row lg:items-center lg:justify-end [&>button]:w-full [&>button]:min-h-8 [&>button]:py-2 lg:[&>button]:w-auto lg:[&>button]:min-h-7 lg:[&>button]:py-1">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
