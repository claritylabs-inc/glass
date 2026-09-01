import { makeFunctionReference } from "convex/server";

import type { Id } from "@/convex/_generated/dataModel";
import type { PageContext } from "@/hooks/use-page-context";

type BackendThread = {
  _id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
};

type BackendMessage = {
  _id: string;
  role: "user" | "agent" | "system";
  content: string;
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  attachments?: BackendAttachment[];
};

export type OperatorAgentAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

type BackendAttachment = OperatorAgentAttachment;

type BackendRun = {
  status:
    | "queued"
    | "running"
    | "waiting_confirmation"
    | "completed"
    | "failed"
    | "cancelled";
};

type BackendConfirmation = {
  _id: string;
  summary: string;
  toolName: string;
  effect:
    | "read"
    | "reversible_write"
    | "external_send"
    | "access_change"
    | "global_change"
    | "destructive";
  targetKind?: string;
  targetId?: string;
  expiresAt: number;
};

type ListThreadsArgs = { limit?: number };
type GetThreadArgs = { threadId: string };
type GetThreadResult = {
  thread: BackendThread;
  messages: BackendMessage[];
  activeRun: BackendRun | null;
  pendingConfirmation: BackendConfirmation | null;
};
type CreateThreadArgs = { initialContext?: PageContext };
type SendMessageArgs = {
  threadId: string;
  content: string;
  pageContext?: PageContext;
  attachments?: BackendAttachment[];
};
type GetAttachmentUrlArgs = { threadId: string; fileId: Id<"_storage"> };
type CancelRunArgs = { threadId: string };
type ConfirmActionArgs = {
  threadId: string;
  confirmationId: string;
  decision: "approve" | "reject";
};
type ConfirmActionResult =
  | { status: "needs_refresh"; runId: string }
  | { status: "expired" | "rejected"; runId: string; content: string }
  | {
      status: "completed" | "failed";
      runId: string;
      result: unknown;
      content: string;
    };

export type OperatorAgentThread = {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
};

export type OperatorAgentConfirmation = {
  id: string;
  title: string;
  destructive: boolean;
};

export type OperatorAgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  attachments?: BackendAttachment[];
};

export type OperatorAgentThreadDetail = {
  thread: OperatorAgentThread | null;
  messages: OperatorAgentMessage[];
  activeRun: boolean;
  pendingConfirmation?: OperatorAgentConfirmation;
};

export const operatorAgentApi = {
  listThreads: makeFunctionReference<"query", ListThreadsArgs, BackendThread[]>(
    "operatorAgent:listThreads",
  ),
  getThread: makeFunctionReference<"query", GetThreadArgs, GetThreadResult>(
    "operatorAgent:getThread",
  ),
  createThread: makeFunctionReference<"mutation", CreateThreadArgs, string>(
    "operatorAgent:createThread",
  ),
  generateUploadUrl: makeFunctionReference<
    "mutation",
    Record<string, never>,
    string
  >("operatorAgent:generateUploadUrl"),
  getAttachmentUrl: makeFunctionReference<
    "query",
    GetAttachmentUrlArgs,
    string | null
  >("operatorAgent:getAttachmentUrl"),
  sendMessage: makeFunctionReference<
    "mutation",
    SendMessageArgs,
    { threadId: string; messageId: string; runId: string; duplicate: boolean }
  >("operatorAgent:sendMessage"),
  cancelRun: makeFunctionReference<
    "mutation",
    CancelRunArgs,
    { cancelled: boolean }
  >("operatorAgent:cancelRun"),
  confirmAction: makeFunctionReference<
    "mutation",
    ConfirmActionArgs,
    ConfirmActionResult
  >("operatorAgent:confirmAction"),
} as const;

function normalizeThread(thread: BackendThread): OperatorAgentThread {
  return {
    id: thread._id,
    title: thread.title,
    createdAt: thread.createdAt,
    lastMessageAt: thread.lastMessageAt,
  };
}

function normalizeConfirmation(
  confirmation: BackendConfirmation | null,
): OperatorAgentConfirmation | undefined {
  if (!confirmation) return undefined;
  return {
    id: confirmation._id,
    title: confirmation.summary,
    destructive: confirmation.effect === "destructive",
  };
}

export function normalizeOperatorAgentThreads(
  threads: BackendThread[] | undefined,
): OperatorAgentThread[] {
  return (threads ?? []).map(normalizeThread);
}

export function normalizeOperatorAgentThread(
  value: GetThreadResult | undefined,
): OperatorAgentThreadDetail {
  if (!value) {
    return { thread: null, messages: [], activeRun: false };
  }
  return {
    thread: normalizeThread(value.thread),
    messages: value.messages.map((message) => ({
      id: message._id,
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      attachments: message.attachments,
    })),
    activeRun: value.activeRun !== null,
    pendingConfirmation: normalizeConfirmation(value.pendingConfirmation),
  };
}
