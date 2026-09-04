import type React from "react";
import type { ThreadConversationItem } from "@/lib/thread-display";

export type NavShortcut = {
  key: string;
  type?: "navigation" | "command";
};

export type NavItemConfig = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: NavShortcut;
};

export type ConversationItem = ThreadConversationItem;
