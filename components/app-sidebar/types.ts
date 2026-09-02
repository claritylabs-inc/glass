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

export type ClientThreadItem = {
  _id: string;
  _creationTime: number;
  title: string;
  lastMessageAt?: number;
  originChannel?: "chat" | "email" | "imessage" | "slack";
  threadPhone?: string;
  slackConversationKind?: "channel" | "direct_message";
  visibility?: "broker_visible" | "client_internal" | "user_private";
};
