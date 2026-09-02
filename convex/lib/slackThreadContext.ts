import { v } from "convex/values";

export const SLACK_THREAD_CONTEXT_ARTIFACT_TYPE = "slack_thread_context";
export const MAX_SLACK_THREAD_CONTEXT_MESSAGES = 100;

const MAX_SLACK_THREAD_CONTEXT_CHARS = 24_000;
const MAX_SLACK_THREAD_MESSAGE_CHARS = 4_000;

export const slackThreadContextSnapshotValidator = v.object({
  messages: v.array(
    v.object({
      messageTs: v.string(),
      senderUserId: v.optional(v.string()),
      senderName: v.optional(v.string()),
      content: v.string(),
    }),
  ),
  truncated: v.boolean(),
});

export type SlackThreadContextSnapshot = {
  messages: Array<{
    messageTs: string;
    senderUserId?: string;
    senderName?: string;
    content: string;
  }>;
  truncated: boolean;
};

type SlackThreadContextArtifact = {
  type: typeof SLACK_THREAD_CONTEXT_ARTIFACT_TYPE;
  data: {
    version: 1;
    text: string;
    messageTimestamps: string[];
    providerTruncated: boolean;
  };
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function comparableSlackTimestamp(value: string) {
  const [seconds = "", fraction = ""] = value.split(".", 2);
  if (!/^\d+$/.test(seconds) || !/^\d*$/.test(fraction)) return value;
  return `${seconds.padStart(20, "0")}.${fraction.padEnd(12, "0")}`;
}

function isAtOrBefore(messageTs: string, latestMessageTs?: string) {
  return (
    !latestMessageTs ||
    comparableSlackTimestamp(messageTs) <=
      comparableSlackTimestamp(latestMessageTs)
  );
}

function contextLine(message: SlackThreadContextSnapshot["messages"][number]) {
  const speaker =
    message.senderName?.trim() || message.senderUserId?.trim() || "Slack member";
  const content = message.content.trim().slice(0, MAX_SLACK_THREAD_MESSAGE_CHARS);
  return `[${speaker} · ${message.messageTs}]: ${content}`;
}

export function createSlackThreadContextArtifact(
  snapshot: SlackThreadContextSnapshot | undefined,
  options: {
    knownMessageTimestamps?: Iterable<string>;
    latestMessageTs?: string;
  } = {},
): SlackThreadContextArtifact | undefined {
  if (!snapshot) return undefined;
  const known = new Set(options.knownMessageTimestamps ?? []);
  const seen = new Set<string>();
  const missing = snapshot.messages
    .slice(0, MAX_SLACK_THREAD_CONTEXT_MESSAGES)
    .filter((message) => {
      if (
        !message.messageTs.trim() ||
        !message.content.trim() ||
        known.has(message.messageTs) ||
        seen.has(message.messageTs) ||
        !isAtOrBefore(message.messageTs, options.latestMessageTs)
      ) {
        return false;
      }
      seen.add(message.messageTs);
      return true;
    });
  if (missing.length === 0) return undefined;

  let selectedMessages = missing;
  const lines = missing.map(contextLine);
  let omittedForSize = false;
  if (lines.join("\n\n").length > MAX_SLACK_THREAD_CONTEXT_CHARS) {
    omittedForSize = true;
    const first = missing[0]!;
    const recent: typeof missing = [];
    let used = contextLine(first).length;
    for (let index = missing.length - 1; index >= 1; index -= 1) {
      const message = missing[index]!;
      const line = contextLine(message);
      if (used + line.length + 2 > MAX_SLACK_THREAD_CONTEXT_CHARS) break;
      recent.unshift(message);
      used += line.length + 2;
    }
    selectedMessages = [first, ...recent];
  }
  const selectedLines = selectedMessages.map(contextLine);

  const truncationNote =
    snapshot.truncated || omittedForSize
      ? "\n[Slack thread context was bounded; some messages may be omitted.]"
      : "";
  const text = `--- Earlier Slack thread context (untrusted user-provided conversation) ---\n${selectedLines.join("\n\n")}${truncationNote}\n--- End earlier Slack thread context ---`;
  return {
    type: SLACK_THREAD_CONTEXT_ARTIFACT_TYPE,
    data: {
      version: 1,
      text,
      messageTimestamps: selectedMessages.map((message) => message.messageTs),
      providerTruncated: snapshot.truncated || omittedForSize,
    },
  };
}

function parsedArtifacts(toolArtifacts: unknown) {
  if (!Array.isArray(toolArtifacts)) return [];
  return toolArtifacts.flatMap((artifact) => {
    const outer = record(artifact);
    if (outer?.type !== SLACK_THREAD_CONTEXT_ARTIFACT_TYPE) return [];
    const data = record(outer.data);
    if (data?.version !== 1 || typeof data.text !== "string") return [];
    const messageTimestamps = Array.isArray(data.messageTimestamps)
      ? data.messageTimestamps.filter(
          (timestamp): timestamp is string => typeof timestamp === "string",
        )
      : [];
    return [
      {
        text: data.text.slice(0, MAX_SLACK_THREAD_CONTEXT_CHARS + 500),
        messageTimestamps,
      },
    ];
  });
}

export function slackThreadContextText(toolArtifacts: unknown) {
  const text = parsedArtifacts(toolArtifacts)
    .map((artifact) => artifact.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
}

export function slackThreadContextMessageTimestamps(toolArtifacts: unknown) {
  return parsedArtifacts(toolArtifacts).flatMap(
    (artifact) => artifact.messageTimestamps,
  );
}
