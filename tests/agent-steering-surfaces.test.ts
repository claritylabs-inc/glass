import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("agent steering surfaces", () => {
  it("supports @ and / steering targets in the prompt input", () => {
    const promptInput = read("components/glass-prompt-input.tsx");
    const messageType = read("components/ai-elements/prompt-input/prompt-input.tsx");

    expect(messageType).toContain('"policy" | "quote" | "requirement" | "mailbox"');
    expect(promptInput).toContain("findActiveTrigger");
    expect(promptInput).toContain("useCachedAgentTargets");
    expect(promptInput).toContain('activeTrigger.marker === "/"');
    expect(promptInput).toContain('["policy", "quote", "requirement"]');
    expect(promptInput).toContain("TriggerHintTags");
    expect(promptInput).toContain("selectTarget");
  });

  it("persists selected targets and routes them into agent context", () => {
    const schema = read("convex/schema.ts");
    const threads = read("convex/threads.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const mailboxCoordinator = read("convex/actions/mailboxCoordinator.ts");
    const targets = read("convex/agentTargets.ts");

    expect(schema).toContain("referencedRequirementIds");
    expect(schema).toContain("referencedMailboxIds");
    expect(threads).toContain("referencedRequirementIds");
    expect(threads).toContain("referencedMailboxIds");
    expect(processThreadChat).toContain("USER-SELECTED CONTEXT TARGETS");
    expect(processThreadChat).toContain("referencedMailboxIds");
    expect(processThreadChat).toContain("accountIds: args.referencedMailboxIds");
    expect(mailboxCoordinator).toContain("USER-SELECTED MAILBOXES");
    expect(mailboxCoordinator).toContain("selectedAccountRows");
    expect(targets).toContain("policies");
    expect(targets).toContain("quotes");
    expect(targets).toContain("requirements");
    expect(targets).toContain("mailboxes");
  });
});
