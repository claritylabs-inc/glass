export type TextChannelCommandName =
  | "help"
  | "cancel"
  | "reset"
  | "status"
  | "drafts"
  | "send"
  | "discard"
  | "leave"
  | "whoami";

export type TextChannelCommandTarget = "all" | number;

export type ParsedTextChannelCommand =
  | {
      kind: "known";
      name: TextChannelCommandName;
      rawName: string;
      args: string[];
      target?: TextChannelCommandTarget;
    }
  | {
      kind: "unknown";
      rawName: string;
      args: string[];
    };

const COMMAND_ALIASES: Record<string, TextChannelCommandName> = {
  "/cancel": "cancel",
  "/commands": "help",
  "/discard": "discard",
  "/drafts": "drafts",
  "/help": "help",
  "/leave": "leave",
  "/new": "reset",
  "/reset": "reset",
  "/send": "send",
  "/status": "status",
  "/whoami": "whoami",
};

export const TEXT_CHANNEL_COMMAND_HELP =
  "Commands: /help, /commands, /status, /drafts, /send 1|all, /discard 1|all, /cancel, /reset, /new, /leave, /whoami. Try /drafts then /send 1.";

function parseTarget(args: string[]): TextChannelCommandTarget | undefined {
  const first = args[0]?.trim().toLowerCase();
  if (!first) return undefined;
  if (first === "all") return "all";
  if (!/^\d+$/.test(first)) return undefined;
  const value = Number(first);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function parseTextChannelCommand(
  text: string,
): ParsedTextChannelCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawName = "/", ...args] = trimmed.split(/\s+/);
  const normalizedName = rawName.toLowerCase();
  const name = COMMAND_ALIASES[normalizedName];
  if (!name) {
    return {
      kind: "unknown",
      rawName,
      args,
    };
  }

  return {
    kind: "known",
    name,
    rawName,
    args,
    target: parseTarget(args),
  };
}
