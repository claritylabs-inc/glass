import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseTextChannelCommand,
  TEXT_CHANNEL_COMMAND_HELP,
} from "../convex/lib/textChannelCommands";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("text channel slash commands", () => {
  it("parses the deterministic iMessage command set and aliases", () => {
    expect(parseTextChannelCommand("/help")).toMatchObject({
      kind: "known",
      name: "help",
    });
    expect(parseTextChannelCommand("/commands")).toMatchObject({
      kind: "known",
      name: "help",
    });
    expect(parseTextChannelCommand("/new")).toMatchObject({
      kind: "known",
      name: "reset",
    });
    expect(parseTextChannelCommand("/send all")).toMatchObject({
      kind: "known",
      name: "send",
      target: "all",
    });
    expect(parseTextChannelCommand("/discard 2")).toMatchObject({
      kind: "known",
      name: "discard",
      target: 2,
    });
  });

  it("leaves ordinary text alone and handles unknown slash commands deterministically", () => {
    expect(parseTextChannelCommand("help")).toBeNull();
    expect(parseTextChannelCommand("Can you help?")).toBeNull();
    expect(parseTextChannelCommand("/wat")).toEqual({
      kind: "unknown",
      rawName: "/wat",
      args: [],
    });
  });

  it("keeps the public help text aligned with the implemented commands", () => {
    for (const command of [
      "/help",
      "/commands",
      "/status",
      "/drafts",
      "/send",
      "/discard",
      "/cancel",
      "/reset",
      "/new",
      "/leave",
      "/whoami",
    ]) {
      expect(TEXT_CHANNEL_COMMAND_HELP).toContain(command);
    }
  });

  it("routes slash commands before natural-language controls and model generation", () => {
    const inbound = read("convex/actions/handleInboundImessage.ts");
    const executor = read("convex/lib/imessageSlashCommands.ts");
    const slashGate = inbound.indexOf("const slashCommandResult");

    expect(inbound).toContain("runImessageSlashCommand");
    expect(slashGate).toBeGreaterThan(-1);
    expect(slashGate).toBeLessThan(
      inbound.indexOf("isPendingEmailRestoreIntent(args.messageText)"),
    );
    expect(slashGate).toBeLessThan(inbound.indexOf("const taskControlIntent"));
    expect(slashGate).toBeLessThan(inbound.indexOf("generateText({"));
    expect(inbound).toContain("internal.imessageChats.markLeft");
    expect(executor).toContain("sendDraftInternal");
    expect(executor).toContain("cancelInternal");
    expect(executor).toContain("Unknown command");
  });
});
