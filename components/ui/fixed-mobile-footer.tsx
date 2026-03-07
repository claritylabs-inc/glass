"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export function FixedMobileFooter({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed bottom-0 inset-x-0 z-50 md:hidden border-t border-foreground/6 bg-white/60 backdrop-blur-sm px-4 py-3"
    >
      <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
        {children}
      </div>
    </motion.div>
  );
}
