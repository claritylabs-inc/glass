"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ThreadMessageBubble({
  role,
  channel,
  isOwnMessage,
  isError,
  children,
}: {
  role: "agent" | "user";
  channel?: "chat" | "email" | "imessage";
  isOwnMessage?: boolean;
  isError?: boolean;
  children: ReactNode;
}) {
  if (role === "agent") {
    if (!isError) {
      return (
        <div
          className={cn(
            "text-foreground",
            channel === "imessage" ? "text-sm leading-5" : "text-base",
          )}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        className={cn(
          "rounded-lg border border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400",
          channel === "imessage" ? "px-3 py-2" : "px-3.5 py-2.5",
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg px-3.5 py-2.5 text-foreground",
        channel === "imessage" ? "text-sm leading-5" : "text-base",
        channel === "email"
          ? [
              "border border-foreground/6",
              isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]",
            ]
          : isOwnMessage
            ? "bg-foreground/[0.06]"
            : "bg-foreground/[0.03]",
      )}
    >
      {children}
    </div>
  );
}
