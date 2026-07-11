"use client";

import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return (
    <Group
      className={cn("h-full w-full min-w-0", className)}
      resizeTargetMinimumSize={{ coarse: 28, fine: 12 }}
      {...props}
    />
  );
}

function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel {...props} />;
}

function ResizableSeparator({
  className,
  disableDoubleClick = true,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative z-20 hidden w-px bg-transparent outline-none lg:block",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors",
        "data-[separator=hover]:after:bg-foreground/10 data-[separator=focus]:after:bg-foreground/10 data-[separator=active]:after:bg-foreground/16",
        className,
      )}
      disableDoubleClick={disableDoubleClick}
      {...props}
    />
  );
}

export { ResizablePanel, ResizablePanelGroup, ResizableSeparator };
