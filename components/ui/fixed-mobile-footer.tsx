"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export function FixedMobileFooter({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 md:hidden">
      {/* Gradient fade — body background color fading in from transparent */}
      <div
        className="pointer-events-none h-10"
        style={{
          background:
            "linear-gradient(to bottom, rgba(250,248,244,0) 0%, rgba(250,248,244,0.6) 50%, rgba(250,248,244,1) 100%)",
        }}
      />
      {/* Footer bar */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="border-t border-foreground/8 bg-white/80 px-4 py-3"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
