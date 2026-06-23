function normalizeResponseCueText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCoiRequestIntent(messageText: string, recentContext?: string): boolean {
  const normalized = normalizeResponseCueText(
    `${messageText}\n${recentContext ?? ""}`,
  );
  return /\b(coi|certificate of insurance|certificate holder|cert holder|generate (a )?certificate|issue (a )?certificate)\b/.test(
    normalized,
  );
}

function claimsCoiCompletion(messageText: string): boolean {
  const normalized = normalizeResponseCueText(messageText);
  if (!/\b(coi|certificate|cert)\b/.test(normalized)) return false;
  return /\b(generated|created|issued|attached|sent|ready|completed|done|found an existing)\b/.test(
    normalized,
  );
}

function asksForInternalPolicyRecordId(messageText: string): boolean {
  return /\b(internal policy id|policy record id|internal record id|convex id|string of characters)\b/i.test(
    messageText,
  );
}

const GENERIC_IMESSAGE_CTA_PATTERNS = [
  /\s*if you (?:want|would like),? i can (?:zoom|dig|break|expand)[^.!?]*[.!?]?\s*$/i,
  /\s*i can (?:zoom|dig|break|expand)[^.!?]*[.!?]?\s*$/i,
  /\s*want (?:more|me to)[^.!?]*[.!?]?\s*$/i,
  /\s*ask me to expand[.!?]?\s*$/i,
];

function cleanImessageResponseText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripGenericImessageCta(text: string): string {
  let current = cleanImessageResponseText(text);
  for (const pattern of GENERIC_IMESSAGE_CTA_PATTERNS) {
    current = current.replace(pattern, "").trim();
  }
  return current;
}

export function postProcessImessageResponseText(args: {
  messageText: string;
  recentConversationContext: string;
  responseText: string;
  usedTools: string[];
  responseFileAttachments: Array<{ filename: string }>;
  shouldStripGenericCta: boolean;
}): string {
  let responseText = args.responseText;
  const completedCoiSideEffect =
    args.usedTools.includes("generate_coi") ||
    args.responseFileAttachments.some((attachment) =>
      /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(attachment.filename),
    );

  if (
    hasCoiRequestIntent(args.messageText, args.recentConversationContext) &&
    claimsCoiCompletion(responseText) &&
    !completedCoiSideEffect
  ) {
    responseText =
      "I haven't generated that COI yet. I need to resolve the policy and create the certificate first.";
  }

  if (asksForInternalPolicyRecordId(responseText)) {
    responseText =
      "I can use the policy number, named insured, carrier, or a policy list result instead.";
  }

  return args.shouldStripGenericCta
    ? stripGenericImessageCta(responseText)
    : responseText;
}
