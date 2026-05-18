import type { Id } from "@/convex/_generated/dataModel";
import type React from "react";

export type NavShortcut = {
  key: string;
};

export type NavItemConfig = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: NavShortcut;
};

export type ConversationItem = {
  kind: "email" | "chat" | "imessage";
  id: string;
  label: string;
  time: number;
};

export type ClientThreadItem = {
  _id: string;
  _creationTime: number;
  title: string;
  lastMessageAt?: number;
  originChannel?: "chat" | "email" | "imessage";
  threadPhone?: string;
};

export type BrokerContact = {
  name: string;
  iconUrl?: string | null;
  whiteLabelingEnabled?: boolean;
  brandingColor?: string;
  agentHandle?: string;
  primaryContact: {
    userId: string;
    name?: string;
    email?: string;
    phone?: string;
    title?: string;
  } | null;
} | null;

export type MergeSuggestionPayload = {
  primaryPolicyId: string;
  secondaryPolicyId: string;
  notificationId?: Id<"notifications">;
};
