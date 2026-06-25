import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("agent steering surfaces", () => {
  it("supports @ and / steering targets in the prompt input", () => {
    const promptInput = read("components/glass-prompt-input.tsx");
    const messageType = read("components/ai-elements/prompt-input/prompt-input.tsx");

    expect(messageType).toContain('"policy" | "requirement" | "mailbox"');
    expect(promptInput).toContain("findActiveTrigger");
    expect(promptInput).toContain("useCachedAgentTargets");
    expect(promptInput).toContain("targetKindsForTrigger(activeTrigger)");
    expect(promptInput).toContain('trigger.marker === "/"');
    expect(promptInput).toContain('["policy", "requirement"]');
    expect(promptInput).toContain("PromptReferenceTag");
    expect(promptInput).toContain("selectTarget");
  });

  it("prepares prompt steering actions before focus without adding a new target source", () => {
    const promptInput = read("components/glass-prompt-input.tsx");

    expect(promptInput).toContain("PreparedInputActions");
    expect(promptInput).toContain("PREPARED_ACTION_INTENT_THRESHOLD");
    expect(promptInput).toContain("pointerIntent >= PREPARED_ACTION_INTENT_THRESHOLD");
    expect(promptInput).toContain("data-glass-prepared-actions");
    expect(promptInput).toContain('window.matchMedia("(pointer: fine)")');
    expect(promptInput).toContain("Math.hypot(dx, dy)");
    expect(promptInput).toContain("requestAnimationFrame");
    expect(promptInput).toContain("PREPARED_POLICY_TARGET_KINDS");
    expect(promptInput).toContain('["policy"]');
    expect(promptInput).toContain("PREPARED_REQUIREMENT_TARGET_KINDS");
    expect(promptInput).toContain('["requirement"]');
    expect(promptInput).toContain("PREPARED_MAILBOX_TARGET_KINDS");
    expect(promptInput).toContain('["mailbox"]');
    expect(promptInput).toContain("preparedKinds");
    expect(promptInput).toContain("openPreparedTargetPicker");
    expect(promptInput).toContain("attachments.openFileDialog()");
    expect(promptInput).toContain("useCachedAgentTargets(orgId)");
    expect(promptInput).toContain(
      '<PromptInputTools className="min-w-0 flex-1 overflow-hidden">',
    );
    expect(promptInput).toContain("transition-[max-width,opacity,transform,margin]");
    expect(promptInput).toContain("max-w-0");
    expect(promptInput).not.toContain("pointer-events-none absolute z-20");
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
    expect(processThreadChat).toContain("accountIds: referencedMailboxIds");
    expect(mailboxCoordinator).toContain("USER-SELECTED MAILBOXES");
    expect(mailboxCoordinator).toContain("selectedAccountRows");
    expect(targets).toContain("policies");
    expect(targets).not.toContain("quotes:");
    expect(targets).toContain("requirements");
    expect(targets).toContain("mailboxes");
  });
});
