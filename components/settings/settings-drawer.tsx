"use client";

import type { ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

const EASE = [0.2, 0, 0, 1] as const;

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  actions,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

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
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
            transition={{ duration: 0.1, ease: EASE }}
            className="flex min-h-0 w-full flex-1 flex-col border-l border-foreground/6 bg-background"
          >
            <div className="min-h-12 flex items-center gap-3 px-4 py-2 border-b border-foreground/6 shrink-0">
              <div className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                {title}
              </div>
              {actions ? <div className="shrink-0">{actions}</div> : null}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="flex flex-col my-4">{children}</div>
            </div>

            {footer && (
              <div className="border-t border-foreground/6 px-4 py-3 flex flex-col-reverse items-stretch gap-2 shrink-0 sm:flex-row sm:items-center sm:justify-end [&>button]:w-full [&>button]:min-h-8 [&>button]:py-2 sm:[&>button]:w-auto sm:[&>button]:min-h-7 sm:[&>button]:py-1">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
