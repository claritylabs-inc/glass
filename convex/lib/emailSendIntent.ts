type ExplicitEmailSendSource = {
  orgId: unknown;
  threadId: unknown;
  role: string;
  content: string;
  userId?: unknown;
  fromEmail?: string;
};

const NEGATED_SEND_PATTERNS = [
  /\bshould\s+(?:i|we)\s+(?:send|email|forward|deliver)\b/i,
  /\bdo\s+you\s+think\s+(?:i|we)\s+should\s+(?:send|email|forward|deliver)\b/i,
  /^(?:what|why|how|when|where|who|is|are|do|does|did)\b[^?]*\b(?:send|email|forward|deliver)(?:ing)?\b/i,
  /\bif\s+(?:i|we|you)\s+(?:send|email|forward|deliver)\b/i,
  /\b(?:do not|don't|dont|never)\b[^.!?]{0,48}\b(?:send|email|forward|deliver)\b/i,
  /\b(?:but\s+not|without)\s+(?:send|email|forward|deliver)(?:ing)?\b/i,
  /\b(?:draft only|just draft|draft(?:ing)?\s+only)\b/i,
  /\b(?:hold off|wait)\s+(?:on\s+|to\s+|before\s+)?(?:send|email|forward|deliver)(?:ing)?\b/i,
  /\b(?:send|email|forward|deliver)(?:ing)?\b[^.!?]{0,48}\b(?:not yet|later instead)\b/i,
];

const EXPLICIT_SEND_PATTERNS = [
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:draft\s+(?:an?\s+email\s+)?and\s+)?(?:send|email|forward|deliver)\b/i,
  /\bplease\s+(?:draft\s+(?:an?\s+email\s+)?and\s+)?(?:send|email|forward|deliver)\b/i,
  /\b(?:go ahead|proceed)\s+(?:and\s+|to\s+)?(?:send|email|forward|deliver)\b/i,
  /\b(?:draft|write|prepare|compose)\b[^.!?]{0,80}\band\s+(?:then\s+)?send\b/i,
  /^(?:thanks[,!]?\s*)?(?:draft\s+(?:an?\s+email\s+)?and\s+)?(?:send|email|forward|deliver)\b/i,
  /\b(?:i\s+(?:want|need)\s+you\s+to|you\s+(?:can|may))\s+(?:send|email|forward|deliver)\b/i,
];

function withoutQuotedContent(messageText: string): string {
  return messageText
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/“[^”\n]*”/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/**
 * Recognizes only an affirmative, current-turn direction to deliver email.
 * Questions about sending and draft-only requests deliberately remain outside
 * this authorization path.
 */
export function isExplicitEmailSendRequest(messageText: string): boolean {
  const text = withoutQuotedContent(messageText).trim();
  if (!text || NEGATED_SEND_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return EXPLICIT_SEND_PATTERNS.some((pattern) => pattern.test(text));
}

export function sourceExplicitlyNamesEmailAddress(
  messageText: string,
  email: string,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const escapedEmail = normalizedEmail.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const emailCharacter = "a-z0-9.!#$%&'*+/=?^_`{|}~@-";
  return new RegExp(
    `(^|[^${emailCharacter}])${escapedEmail}(?=$|[^${emailCharacter}])`,
    "i",
  ).test(messageText);
}

export function isActorBoundExplicitEmailSendSource(args: {
  message: ExplicitEmailSendSource | null;
  orgId: unknown;
  threadId: unknown;
  actorUserId: unknown;
  actorEmail?: string;
}): boolean {
  const { message } = args;
  if (
    !message ||
    message.role !== "user" ||
    String(message.orgId) !== String(args.orgId) ||
    String(message.threadId) !== String(args.threadId) ||
    !isExplicitEmailSendRequest(message.content)
  ) {
    return false;
  }

  if (message.userId) {
    return String(message.userId) === String(args.actorUserId);
  }

  return Boolean(
    message.fromEmail &&
      args.actorEmail &&
      message.fromEmail.trim().toLowerCase() ===
        args.actorEmail.trim().toLowerCase(),
  );
}
