"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      gap={8}
      toastOptions={{
        className:
          "!bg-card dark:!bg-popover/95 !backdrop-blur-xl !border !border-foreground/8 !shadow-lg !shadow-black/[0.08] !rounded-xl !text-foreground !text-body-sm !font-[var(--font-geist-sans)]",
        descriptionClassName: "!text-muted-foreground !text-label-sm",
      }}
    />
  );
}
