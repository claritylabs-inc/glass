export function normalizePendingEmailIntentText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[,;:]+/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isPendingEmailCancelIntent(text: string) {
  const normalized = normalizePendingEmailIntentText(text);
  if (!normalized) return false;
  return (
    /^(cancel|undo|stop|abort|nevermind|never mind|hold on|wait|no)$/.test(normalized) ||
    /^(cancel|stop|abort) (it|that|this|the email|email|the draft|draft|sending|the send)$/.test(normalized) ||
    /^(please )?(cancel|stop|abort) (it|that|this|the email|email|the draft|draft|sending|the send)$/.test(normalized) ||
    /^(don'?t|do not) send( it| that| this| the email| email| the draft| draft)?$/.test(normalized)
  );
}

export function isPendingEmailCancelConfirmation(text: string) {
  const normalized = normalizePendingEmailIntentText(text);
  return /^(yes|yep|yeah|confirm|confirmed|yes cancel|yes cancel it|please cancel|cancel it|cancel the email|cancel the draft|do it)$/.test(normalized);
}

export function isPendingEmailRestoreIntent(text: string) {
  const normalized = normalizePendingEmailIntentText(text);
  if (!normalized) return false;
  return /^(restore|restore it|restore the email|restore the draft|restore draft|uncancel|uncancel it|uncancel email|uncancel the email|un cancel|un cancel it|un cancel email|un cancel the email|undo cancellation|undo cancel|undo the cancellation|undo the cancel|bring it back)$/.test(normalized);
}

export function isPendingEmailCancelConfirmationPrompt(text?: string) {
  if (!text) return false;
  return /confirm you want (me )?to cancel ((the|this) )?(draft email|pending email|pending emails|\d+ pending emails|email)/i.test(text);
}

export function pendingEmailCancelConfirmationMessage(kind: "draft" | "pending", count = 1) {
  const target = kind === "draft"
    ? count === 1 ? "the draft email" : `${count} draft emails`
    : count === 1
      ? "the pending email"
      : `${count} pending emails`;
  return `Please confirm you want me to cancel ${target}. Reply "yes, cancel" to cancel, or tell me what to change.`;
}
