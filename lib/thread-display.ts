const IMESSAGE_DIRECT_TITLE_PREFIX = "iMessage - ";
const IMESSAGE_GROUP_TITLE_PREFIX = "iMessage group - ";

export type ThreadDisplayLike = {
  _id: string;
  _creationTime: number;
  title: string;
  lastMessageAt?: number;
  originChannel?: "chat" | "email" | "imessage" | "slack";
  threadPhone?: string;
  slackConversationKind?: "channel" | "direct_message";
};

export type ThreadConversationItem = {
  kind: "email" | "chat" | "imessage" | "slack";
  id: string;
  label: string;
  time: number;
};

export const SIDEBAR_AGENT_THREAD_LIMIT = 8;
export const SIDEBAR_IMESSAGE_THREAD_LIMIT = 8;
export const SIDEBAR_SLACK_THREAD_LIMIT = 8;

export function isImessageThread(thread: ThreadDisplayLike) {
  return (
    thread.originChannel === "imessage" ||
    Boolean(thread.threadPhone) ||
    thread.title.startsWith(IMESSAGE_DIRECT_TITLE_PREFIX) ||
    thread.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)
  );
}

export function getThreadDisplayLabel(thread: ThreadDisplayLike) {
  if (!isImessageThread(thread)) return thread.title;

  const withoutDirectPrefix = thread.title.startsWith(
    IMESSAGE_DIRECT_TITLE_PREFIX,
  )
    ? thread.title.slice(IMESSAGE_DIRECT_TITLE_PREFIX.length).trim()
    : thread.title;
  const withoutGroupPrefix = withoutDirectPrefix.startsWith(
    IMESSAGE_GROUP_TITLE_PREFIX,
  )
    ? withoutDirectPrefix.slice(IMESSAGE_GROUP_TITLE_PREFIX.length).trim()
    : withoutDirectPrefix;

  return withoutGroupPrefix || thread.threadPhone || thread.title;
}

export function toThreadConversationItem(
  thread: ThreadDisplayLike,
): ThreadConversationItem {
  const kind = isImessageThread(thread)
    ? "imessage"
    : thread.originChannel === "slack"
      ? "slack"
      : thread.originChannel === "email"
        ? "email"
        : "chat";

  return {
    kind,
    id: thread._id,
    label: getThreadDisplayLabel(thread),
    time: thread.lastMessageAt ?? thread._creationTime,
  };
}

export function splitThreadConversations(
  threads: ThreadDisplayLike[] | undefined,
  limits: {
    agentLimit?: number;
    imessageLimit?: number;
    slackLimit?: number;
  } = {},
) {
  const agentLimit = limits.agentLimit ?? SIDEBAR_AGENT_THREAD_LIMIT;
  const imessageLimit =
    limits.imessageLimit ?? SIDEBAR_IMESSAGE_THREAD_LIMIT;
  const slackLimit = limits.slackLimit ?? SIDEBAR_SLACK_THREAD_LIMIT;
  const agentConversations: ThreadConversationItem[] = [];
  const pinnedConversations: ThreadConversationItem[] = [];
  let imessageCount = 0;
  let slackCount = 0;

  for (const thread of threads ?? []) {
    const item = toThreadConversationItem(thread);
    if (item.kind === "imessage") {
      if (imessageCount < imessageLimit) {
        pinnedConversations.push(item);
        imessageCount += 1;
      }
      continue;
    }
    if (item.kind === "slack") {
      if (slackCount < slackLimit) {
        pinnedConversations.push(item);
        slackCount += 1;
      }
      continue;
    }

    if (agentConversations.length < agentLimit) {
      agentConversations.push(item);
    }
  }

  return { agentConversations, pinnedConversations };
}
