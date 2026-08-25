const CANCEL_REQUESTS = new Set([
  "cancel",
  "cancel it",
  "cancel the email",
  "cancel the draft",
  "do not send",
  "don't send",
]);

const CANCEL_CONFIRMATIONS = new Set([
  "yes",
  "yep",
  "yeah",
  "confirm",
  "confirmed",
  "yes cancel",
  "yes cancel it",
  "please cancel",
  "confirm cancel",
  "cancel it",
  "cancel the email",
  "cancel the draft",
  "do it",
]);

const RESTORE_REQUESTS = new Set([
  "restore",
  "restore it",
  "restore the email",
  "restore the draft",
  "restore draft",
  "uncancel",
  "uncancel it",
  "uncancel email",
  "uncancel the email",
  "un cancel",
  "un cancel it",
  "un cancel email",
  "un cancel the email",
  "undo cancellation",
  "undo cancel",
  "undo the cancellation",
  "undo the cancel",
  "bring it back",
]);

export function normalizePendingEmailIntentText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[,;:]+/g, "")
    .replace(/[.!?]+$/, "")
    .split(/\s+/)
    .join(" ");
}

export function isPendingEmailCancelIntent(text: string) {
  return CANCEL_REQUESTS.has(normalizePendingEmailIntentText(text));
}

export function isPendingEmailCancelConfirmation(text: string) {
  return CANCEL_CONFIRMATIONS.has(normalizePendingEmailIntentText(text));
}

export function isPendingEmailRestoreIntent(text: string) {
  return RESTORE_REQUESTS.has(normalizePendingEmailIntentText(text));
}

export function pendingEmailCancelConfirmationMessage(
  kind: "draft" | "pending",
  count = 1,
) {
  const target =
    kind === "draft"
      ? count === 1
        ? "the draft email"
        : `${count} draft emails`
      : count === 1
        ? "the pending email"
        : `${count} pending emails`;
  return `Confirm cancellation of ${target} by replying “yes cancel”.`;
}
