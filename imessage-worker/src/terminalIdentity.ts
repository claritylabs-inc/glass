export type TerminalIdentityAliases = Record<string, string>;

export type TerminalIdentityCommand =
  | { kind: "whoami" }
  | { kind: "switch"; label: string; phone: string }
  | { kind: "error"; message: string };

export function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function terminalIdentityLabel(
  phone: string,
  aliases: TerminalIdentityAliases,
): string {
  return (
    Object.entries(aliases).find(([, value]) => value === phone)?.[0] ?? phone
  );
}

export function parseTerminalIdentityCommand(
  message: string,
  aliases: TerminalIdentityAliases,
): TerminalIdentityCommand | null {
  const trimmed = message.trim();
  if (trimmed.toLowerCase() === "/whoami") return { kind: "whoami" };

  const match = trimmed.match(/^\/as(?:\s+(.+))?$/i);
  if (!match) return null;

  const target = match[1]?.trim();
  const available = Object.keys(aliases).join(", ");
  if (!target) {
    return {
      kind: "error",
      message: `Usage: /as <${available}|+E164 phone>`,
    };
  }

  const alias = target.toLowerCase();
  const phone = aliases[alias] ?? target;
  if (!isE164Phone(phone)) {
    return {
      kind: "error",
      message: `Unknown identity. Use ${available}, or a valid E.164 phone number.`,
    };
  }
  return {
    kind: "switch",
    label: aliases[alias] ? alias : phone,
    phone,
  };
}
