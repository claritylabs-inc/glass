import { normalizeUserPhone } from "./userPhone";

export function isImessageEnabled(): boolean {
  return process.env.IMESSAGE_ENABLED === "true";
}

export function isImessageTerminalEnabled(): boolean {
  return process.env.IMESSAGE_TERMINAL_ENABLED === "true";
}

export function isImessageInboundEnabled(): boolean {
  return isImessageEnabled() || isImessageTerminalEnabled();
}

export function getImessageWorkerUrl(): string | undefined {
  if (!isImessageInboundEnabled()) return undefined;
  return process.env.IMESSAGE_WORKER_URL;
}

export function isOperatorImessageEnabled(): boolean {
  return process.env.OPERATOR_IMESSAGE_ENABLED === "true";
}

export function isOperatorImessageTerminalEnabled(): boolean {
  return process.env.OPERATOR_IMESSAGE_TERMINAL_ENABLED === "true";
}

export function isOperatorImessageInboundEnabled(): boolean {
  return isOperatorImessageEnabled() || isOperatorImessageTerminalEnabled();
}

export function getOperatorImessageWorkerUrl(): string | undefined {
  if (!isOperatorImessageInboundEnabled()) return undefined;
  return process.env.OPERATOR_IMESSAGE_WORKER_URL;
}

export function getOperatorImessageContactPhone(): string | undefined {
  try {
    return normalizeUserPhone(
      process.env.OPERATOR_IMESSAGE_CONTACT_PHONE?.trim(),
    );
  } catch {
    return undefined;
  }
}
