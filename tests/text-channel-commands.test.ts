import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMESSAGE_LINKED_SENDER_REQUIRED,
  runImessageSlashCommand,
} from "../convex/lib/imessageSlashCommands";
import type { Id } from "../convex/_generated/dataModel";
import {
  parseTextChannelCommand,
  TEXT_CHANNEL_COMMAND_HELP,
} from "../convex/lib/textChannelCommands";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const commandCtx = {} as Parameters<typeof runImessageSlashCommand>[0];

async function runCommand(messageText: string, currentSenderIsLinked: boolean) {
  const args: Parameters<typeof runImessageSlashCommand>[1] = {
    messageText,
    orgName: "Acme Co",
    userName: "Linked User",
    userEmail: "linked@example.com",
    isGroup: true,
    scopeMode: "client",
    currentSenderIsLinked,
    draftEmails: [
      {
        _id: "draft-1" as Id<"pendingEmails">,
        recipientEmail: "broker@example.com",
        subject: "Sensitive renewal",
      },
    ],
    pendingEmails: [],
    history: [],
  };
  return runImessageSlashCommand(commandCtx, args);
}

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
    expect(TEXT_CHANNEL_COMMAND_HELP.split("\n")).toEqual([
      "Commands:",
      "/help, /commands",
      "/status",
      "/drafts",
      "/send 1, /send all",
      "/discard 1, /discard all",
      "/cancel, /reset, /new",
      "/leave, /whoami",
      "",
      "Try /drafts then /send 1.",
    ]);
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

  it("does not let anonymous group participants use tenant-scoped slash commands", async () => {
    await expect(runCommand("/help", false)).resolves.toMatchObject({
      response: TEXT_CHANNEL_COMMAND_HELP,
    });
    await expect(runCommand("/drafts", false)).resolves.toMatchObject({
      response: IMESSAGE_LINKED_SENDER_REQUIRED,
    });
    await expect(runCommand("/whoami", false)).resolves.toMatchObject({
      response: IMESSAGE_LINKED_SENDER_REQUIRED,
    });
  });

  it("allows linked senders to inspect their slash command state", async () => {
    const result = await runCommand("/whoami", true);
    expect(result?.response).toContain("Linked User");
    expect(result?.response).toContain("Acme Co");
  });

  it("routes slash commands before natural-language controls and model generation", () => {
    const inbound = read("convex/actions/handleInboundImessage.ts");
    const controls = read("convex/lib/imessageDeterministicControls.ts");
    const executor = read("convex/lib/imessageSlashCommands.ts");
    const deterministicGate = inbound.indexOf(
      "const deterministicControlResult",
    );
    const slashGate = controls.indexOf("const slashCommandResult");
    const emailControlGate = controls.indexOf("const emailControl =");
    const taskControlGate = controls.indexOf("const taskControlIntent");

    expect(inbound).toContain("runImessageDeterministicControls");
    expect(deterministicGate).toBeGreaterThan(-1);
    expect(deterministicGate).toBeLessThan(inbound.indexOf("generateText({"));
    expect(controls).toContain("runImessageSlashCommand");
    expect(slashGate).toBeGreaterThan(-1);
    expect(emailControlGate).toBeGreaterThan(-1);
    expect(slashGate).toBeLessThan(emailControlGate);
    expect(taskControlGate).toBeGreaterThan(-1);
    expect(emailControlGate).toBeLessThan(taskControlGate);
    expect(controls).toContain("internal.imessageChats.markLeft");
    expect(controls).toContain("currentSenderIsLinked,");
    const emailControlBlock = controls.slice(
      emailControlGate,
      taskControlGate,
    );
    expect(emailControlBlock).toContain("resolveTextChannelEmailControl");
    expect(emailControlBlock).toContain("restoreAsDraftInternal");
    expect(emailControlBlock).toContain("sendDraftInternal");
    expect(emailControlBlock).toContain("cancelInternal");
    expect(executor).toContain("requiresLinkedSender");
    expect(executor).toContain("sendDraftInternal");
    expect(executor).toContain("cancelInternal");
    expect(executor).toContain("Unknown command");
  });
});
