"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { typeStyle } from "@/lib/typography";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      gap={8}
      visibleToasts={4}
      offset={{
        right: 24,
        bottom:
          "calc(var(--glass-app-bottom-inset, 0px) + var(--glass-settings-drawer-footer-inset, 0px) + 1rem)",
      }}
      mobileOffset={{
        top: 16,
        right: 16,
        bottom:
          "calc(var(--glass-app-bottom-inset, 0px) + var(--glass-settings-drawer-footer-inset, 0px) + env(safe-area-inset-bottom) + 1rem)",
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
          `!overflow-hidden !bg-card dark:!bg-popover/95 !border !border-foreground/8 !shadow-lg !shadow-black/[0.08] !rounded-xl !text-foreground ${typeStyle("body.default")}`,
        descriptionClassName: `!text-muted-foreground ${typeStyle("caption.default")}`,
      }}
    />
  );
}
