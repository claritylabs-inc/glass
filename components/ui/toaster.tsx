"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      expand
      gap={8}
      visibleToasts={4}
      mobileOffset={{
        top: 16,
        right: 16,
        bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)",
        left: 16,
      }}
      style={
        {
          "--width": "min(356px, calc(100vw - 2rem))",
        } as CSSProperties
      }
      toastOptions={{
        style: {
          width: "var(--width)",
          maxWidth: "calc(100vw - 2rem)",
        },
        className:
          "!overflow-hidden !bg-card dark:!bg-popover/95 !border !border-foreground/8 !shadow-lg !shadow-black/[0.08] !rounded-xl !text-foreground !text-base !font-[var(--font-geist-sans)]",
        descriptionClassName: "!text-muted-foreground !text-label",
      }}
    />
  );
}
