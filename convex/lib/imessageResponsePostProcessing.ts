function normalizeResponseCueText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COI_KEYWORD_PATTERN =
  /\b(coi|certificate of insurance|certificate holder|cert holder)\b/;
const COI_ACTION_PATTERN =
  /\b(?:generate|create|issue|make|send|attach|produce|get)\b(?:\s+(?:a|an|the|another|new|current|updated|right))*\s+(?:coi|cert|certificate(?:\s+of\s+insurance)?)\b/;
const COI_REFERENCE_PATTERN = /\b(coi|certificate|cert)\b/;
const COI_COMPLETION_PATTERN =
  /\b(generated|created|issued|attached|sent|ready|completed|done|found an existing)\b/;
const FILE_ATTACHMENT_NEGATION_PATTERN =
  /\b(?:didn t|did not|couldn t|could not|can t|cannot|failed|not|no)\b(?:\s+\w+){0,6}\s+attach/;
const FILE_ATTACHMENT_SUCCESS_PATTERNS = [
  /\b(?:pdf|file|document|attachment)\b(?:\s+\w+){0,8}\s+(?:attached|sent|included|shared|delivered)\b/,
  /\b(?:attached|sent|included|shared|delivered)\b(?:\s+\w+){0,8}\s+(?:pdf|file|document|attachment)\b/,
];
const IMPLICIT_COI_DONE_PATTERN = /\b(sent it|here you go|attached|completed|done)\b/;

function hasCoiRequestIntent(messageText: string, recentContext?: string): boolean {
  const normalized = normalizeResponseCueText(
    `${messageText}\n${recentContext ?? ""}`,
  );
  return (
    COI_KEYWORD_PATTERN.test(normalized) ||
    COI_ACTION_PATTERN.test(normalized)
  );
}

function claimsSuccessfulFileAttachment(messageText: string): boolean {
  const normalized = normalizeResponseCueText(messageText);
  if (FILE_ATTACHMENT_NEGATION_PATTERN.test(normalized)) {
    return false;
  }
  return FILE_ATTACHMENT_SUCCESS_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function claimsCoiCompletion(
  messageText: string,
  coiRequestIntent: boolean,
): boolean {
  const normalized = normalizeResponseCueText(messageText);
  const claimsCompletion = COI_COMPLETION_PATTERN.test(normalized);
  if (COI_REFERENCE_PATTERN.test(normalized) && claimsCompletion) {
    return true;
  }
  return (
    coiRequestIntent &&
    (claimsSuccessfulFileAttachment(messageText) ||
      IMPLICIT_COI_DONE_PATTERN.test(normalized))
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
  const coiRequestIntent = hasCoiRequestIntent(
    args.messageText,
    args.recentConversationContext,
  );
  const completedCoiSideEffect =
    (args.usedTools.includes("generate_coi") &&
      args.responseFileAttachments.length > 0) ||
    args.responseFileAttachments.some((attachment) =>
      /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(attachment.filename),
    );

  if (
    coiRequestIntent &&
    claimsCoiCompletion(responseText, coiRequestIntent) &&
    !completedCoiSideEffect
  ) {
    responseText =
      "I haven't generated that COI yet. I need to resolve the policy and create the certificate first.";
  }

  if (
    claimsSuccessfulFileAttachment(responseText) &&
    args.responseFileAttachments.length === 0
  ) {
    responseText = responseText.trim()
      ? `${responseText.trim()}\n\nCorrection: the file is not attached. I need to generate or attach it before I can say it's attached.`
      : "The file is not attached. I need to generate or attach it before I can say it's attached.";
  }

  if (asksForInternalPolicyRecordId(responseText)) {
    responseText =
      "I can use the policy number, named insured, carrier, or a policy list result instead.";
  }

  return args.shouldStripGenericCta
    ? stripGenericImessageCta(responseText)
    : responseText;
}
