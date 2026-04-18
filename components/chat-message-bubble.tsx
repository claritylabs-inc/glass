"use client";

import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import dayjs from "dayjs";
import { Asterisk, Loader2, AlertCircle, MessageSquare } from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { ContextReferenceCard } from "@/components/context-reference-card";

export type WebChatMessage = {
  _id: Id<"webChatMessages">;
  _creationTime: number;
  chatId: Id<"webChats">;
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  userName?: string;
  role: "user" | "agent";
  content: string;
  status?: "processing" | "error";
  error?: string;
};

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
      <span className="text-[10px] font-semibold text-foreground/60">{initials}</span>
    </div>
  );
}

export function ChatMessageBubble({ message, viewerId }: { message: WebChatMessage; viewerId?: string }) {
  const time = dayjs(message._creationTime).format("h:mm A");

  // Processing state — show streaming content if available, otherwise "Thinking..."
  if (message.role === "agent" && message.status === "processing") {
    const hasContent = message.content && message.content.length > 0;
    return (
      <div className="flex items-start gap-2.5 max-w-lg">
        <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0">
          <Asterisk className="w-3.5 h-3.5 text-primary-light" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-medium text-muted-foreground/50">Prism</p>
            <MessageSquare className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-[11px] text-muted-foreground/30">Chat</span>
          </div>
          {hasContent ? (
            <div className="rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 ${PROSE_MARKDOWN_STYLES} [&_a]:text-blue-600 [&_a]:underline">
              <Markdown remarkPlugins={[remarkBreaks]} components={{
                a: ({ href, children }) => {
                  if (href?.startsWith("/policies/")) {
                    return <ContextReferenceCard href={href}>{children}</ContextReferenceCard>;
                  }
                  return <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                },
              }}>{message.content}</Markdown>
              <span className="inline-block w-1.5 h-4 bg-primary-light rounded-sm animate-pulse ml-0.5 align-middle" />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground/40 text-body-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Thinking...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (message.role === "agent" && message.status === "error") {
    return (
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground/50 mb-1">Prism</p>
          <p className="text-body-sm text-red-600">
            {message.error ?? "Something went wrong. Please try again."}
          </p>
        </div>
      </div>
    );
  }

  // Agent message
  if (message.role === "agent") {
    return (
      <div className="flex items-start gap-2.5 max-w-lg">
        <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0">
          <Asterisk className="w-3.5 h-3.5 text-primary-light" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-medium text-muted-foreground/50">Prism</p>
            <MessageSquare className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-[11px] text-muted-foreground/30">Chat</span>
            <span className="text-muted-foreground/20">·</span>
            <span className="text-[10px] text-muted-foreground/25">{time}</span>
          </div>
          <div className="rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 ${PROSE_MARKDOWN_STYLES} [&_a]:text-blue-600 [&_a]:underline">
            <Markdown remarkPlugins={[remarkBreaks]} components={{
              a: ({ href, children }) => {
                if (href?.startsWith("/policies/") || href?.startsWith("/quotes/")) {
                  return <ContextReferenceCard href={href}>{children}</ContextReferenceCard>;
                }
                return <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{children}</a>;
              },
            }}>{message.content}</Markdown>
          </div>
        </div>
      </div>
    );
  }

  // User message
  const isOwnMessage = viewerId && message.userId === viewerId;

  return (
    <div className={`flex items-start gap-2.5 max-w-lg ${isOwnMessage ? "ml-auto flex-row-reverse" : ""}`}>
      <UserAvatar name={message.userName ?? "User"} />
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-2 mb-1 ${isOwnMessage ? "justify-end" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground/50">{message.userName ?? "User"}</p>
          <span className="text-[10px] text-muted-foreground/25">{time}</span>
        </div>
        <div className={`rounded-lg px-3.5 py-2.5 text-body-sm text-foreground whitespace-pre-wrap ${
          isOwnMessage ? "bg-foreground/[0.06]" : "bg-foreground/[0.03]"
        }`}>
          {message.content}
        </div>
      </div>
    </div>
  );
}
