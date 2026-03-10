"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export function FixedMobileFooter({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 md:hidden pointer-events-none">
      {/* Gradient fade — body background fading in from transparent */}
      <div
        className="h-24"
        style={{
          background:
            "linear-gradient(to bottom, rgba(250,248,244,0) 0%, rgba(250,248,244,0.7) 40%, rgba(250,248,244,1) 70%)",
        }}
      />
      {/* Buttons floating on the gradient */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute bottom-0 inset-x-0 pointer-events-auto px-4 pb-6 pt-2"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
