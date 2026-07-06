import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { AgentScope } from "./agentScope";
import {
  parseTextChannelCommand,
  TEXT_CHANNEL_COMMAND_HELP,
  type ParsedTextChannelCommand,
  type TextChannelCommandTarget,
} from "./textChannelCommands";
import { taskControlResponse } from "./taskControlIntent";

type PendingEmailForCommand = Pick<
  Doc<"pendingEmails">,
  "_id" | "recipientEmail" | "subject" | "sendBlockedReason"
>;

type ImessageCommandHistoryMessage = {
  toolArtifacts?: Array<{ type: string; data: unknown }>;
};

export type ImessageSlashCommandResult = {
  response: string;
  leaveGroup?: boolean;
};

type KnownTextChannelCommand = Extract<
  ParsedTextChannelCommand,
  { kind: "known" }
>;

export const IMESSAGE_LINKED_SENDER_REQUIRED =
  "Only a linked Glass user in this chat can do that.";

function truncate(text: string | undefined, max: number) {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function plural(count: number, singular: string, pluralText = `${singular}s`) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function formatDrafts(
  drafts: PendingEmailForCommand[],
  options?: { showAll?: boolean },
) {
  if (drafts.length === 0) {
    return "No email drafts in this thread.";
  }

  const sample = options?.showAll ? drafts.slice(0, 10) : drafts.slice(0, 3);
  const lines = [
    drafts.length === 1
      ? "1 email draft:"
      : `${drafts.length} email drafts:`,
  ];
  for (const [index, draft] of sample.entries()) {
    lines.push(
      `${index + 1}. ${draft.recipientEmail} - ${truncate(draft.subject, 64) || "(no subject)"}`,
    );
    if (draft.sendBlockedReason) {
      lines.push(`   Needs confirmation: ${truncate(draft.sendBlockedReason, 96)}`);
    }
  }
  if (drafts.length > sample.length) {
    lines.push(`${drafts.length - sample.length} more. Use /drafts all.`);
  }
  lines.push("Use /send 1 or /discard 1.");
  return lines.join("\n");
}

function selectedByTarget<T>(
  rows: T[],
  target: TextChannelCommandTarget | undefined,
) {
  if (target === "all") return rows;
  if (typeof target === "number") {
    return rows[target - 1] ? [rows[target - 1]] : [];
  }
  return rows.length === 1 ? rows : [];
}

function targetHelp(command: "/send" | "/discard", count: number) {
  if (count === 0) {
    return command === "/send"
      ? "No email drafts to send."
      : "No draft or pending emails to discard.";
  }
  return count === 1
    ? `Use ${command} 1.`
    : `Use ${command} 1 or ${command} all.`;
}

async function sendDrafts(
  ctx: ActionCtx,
  drafts: PendingEmailForCommand[],
  target: TextChannelCommandTarget | undefined,
) {
  const selected = selectedByTarget(drafts, target);
  if (selected.length === 0) return targetHelp("/send", drafts.length);

  let sentCount = 0;
  const failures: string[] = [];
  for (const draft of selected) {
    try {
      await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
        id: draft._id,
      });
      sentCount += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (failures.length > 0 && sentCount === 0) {
    return `I couldn't send the draft: ${truncate(failures[0], 120)}`;
  }
  if (failures.length > 0) {
    return `Sent ${sentCount}. ${failures.length} failed.`;
  }
  return sentCount === 1
    ? "Sent the draft email."
    : `Sent ${sentCount} draft emails.`;
}

async function discardEmails(
  ctx: ActionCtx,
  emails: PendingEmailForCommand[],
  target: TextChannelCommandTarget | undefined,
) {
  const selected = selectedByTarget(emails, target);
  if (selected.length === 0) return targetHelp("/discard", emails.length);

  let cancelledCount = 0;
  for (const email of selected) {
    const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
      id: email._id,
    });
    if (ok) cancelledCount += 1;
  }

  return cancelledCount === 1
    ? "Discarded 1 email."
    : `Discarded ${cancelledCount} emails.`;
}

function latestWorkflowSummary(history: ImessageCommandHistoryMessage[]) {
  for (const message of [...history].reverse()) {
    for (const artifact of [...(message.toolArtifacts ?? [])].reverse()) {
      if (artifact.type !== "workflow_outcome") continue;
      if (!isRecord(artifact.data)) continue;
      const comms = isRecord(artifact.data.comms)
        ? artifact.data.comms
        : undefined;
      const headline =
        typeof comms?.headline === "string" ? comms.headline : undefined;
      const workflowKind =
        typeof artifact.data.workflowKind === "string"
          ? artifact.data.workflowKind
          : "workflow";
      const status =
        typeof artifact.data.status === "string"
          ? artifact.data.status
          : undefined;
      return (
        headline ??
        `${workflowKind.replace(/_/g, " ")} ${status ?? ""}`.trim()
      );
    }
  }
  return null;
}

function statusText(args: {
  drafts: PendingEmailForCommand[];
  pendingEmails: PendingEmailForCommand[];
  history: ImessageCommandHistoryMessage[];
}) {
  const lines: string[] = [];
  if (args.drafts.length > 0) {
    lines.push(`${plural(args.drafts.length, "draft")} ready.`);
  }
  if (args.pendingEmails.length > 0) {
    lines.push(`${plural(args.pendingEmails.length, "pending email")} waiting.`);
  }
  const workflow = latestWorkflowSummary(args.history);
  if (workflow) {
    lines.push(`Latest workflow: ${truncate(workflow, 140)}`);
  }
  return lines.length > 0
    ? lines.join("\n")
    : "No active drafts or tracked workflow in this thread.";
}

function whoamiText(args: {
  userName?: string;
  userEmail?: string;
  orgName: string;
  isGroup: boolean;
  scopeMode: AgentScope["mode"];
}) {
  const identity = args.userName || args.userEmail || "your linked Glass user";
  const chatKind = args.isGroup ? "group chat" : "direct chat";
  const scope =
    args.scopeMode === "broker_portfolio" ? "broker portfolio" : "single org";
  return `${identity}. Org: ${args.orgName}. Chat: ${chatKind}. Scope: ${scope}.`;
}

function requiresLinkedSender(command: KnownTextChannelCommand) {
  return command.name !== "help";
}

async function runKnownCommand(
  ctx: ActionCtx,
  command: KnownTextChannelCommand,
  args: {
    orgName: string;
    userName?: string;
    userEmail?: string;
    isGroup: boolean;
    scopeMode: AgentScope["mode"];
    draftEmails: PendingEmailForCommand[];
    pendingEmails: PendingEmailForCommand[];
    history: ImessageCommandHistoryMessage[];
  },
): Promise<ImessageSlashCommandResult> {
  switch (command.name) {
    case "help":
      return { response: TEXT_CHANNEL_COMMAND_HELP };
    case "cancel":
      return { response: taskControlResponse("cancel_task") };
    case "reset":
      return { response: taskControlResponse("reset_task") };
    case "status":
      return {
        response: statusText({
          drafts: args.draftEmails,
          pendingEmails: args.pendingEmails,
          history: args.history,
        }),
      };
    case "drafts":
      return {
        response: formatDrafts(args.draftEmails, {
          showAll: command.args[0]?.toLowerCase() === "all",
        }),
      };
    case "send":
      return {
        response: await sendDrafts(ctx, args.draftEmails, command.target),
      };
    case "discard":
      return {
        response: await discardEmails(
          ctx,
          [...args.draftEmails, ...args.pendingEmails],
          command.target,
        ),
      };
    case "leave":
      return args.isGroup
        ? { response: "Leaving this group chat.", leaveGroup: true }
        : { response: "This is a direct chat, so there is no group to leave." };
    case "whoami":
      return { response: whoamiText(args) };
  }
}

export async function runImessageSlashCommand(
  ctx: ActionCtx,
  args: {
    messageText: string;
    orgName: string;
    userName?: string;
    userEmail?: string;
    isGroup: boolean;
    scopeMode: AgentScope["mode"];
    currentSenderIsLinked: boolean;
    draftEmails: PendingEmailForCommand[];
    pendingEmails: PendingEmailForCommand[];
    history: ImessageCommandHistoryMessage[];
  },
): Promise<ImessageSlashCommandResult | null> {
  const command = parseTextChannelCommand(args.messageText);
  if (!command) return null;

  if (command.kind === "unknown") {
    return {
      response: `Unknown command ${command.rawName}. Send /help for commands.`,
    };
  }

  if (requiresLinkedSender(command) && !args.currentSenderIsLinked) {
    return { response: IMESSAGE_LINKED_SENDER_REQUIRED };
  }

  return runKnownCommand(ctx, command, args);
}
