import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("chat duplicate prevention and COI preview UI", () => {
  it("claims one agent response per user message before calling the model", () => {
    const schema = read("convex/schema.ts");
    const threads = read("convex/threads.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(schema).toContain('replyToMessageId: v.optional(v.id("threadMessages"))');
    expect(schema).toContain('.index("by_replyToMessageId", ["replyToMessageId"])');
    expect(threads).toContain("export const claimAgentResponse = internalMutation");
    expect(threads).toContain('withIndex("by_replyToMessageId"');
    expect(processThreadChat).toContain("internal.threads.claimAgentResponse");
    expect(processThreadChat).toContain("if (!claim.claimed) return");
  });

  it("blocks rapid duplicate submits before Convex subscriptions catch up", () => {
    const threadPage = read("app/agent/thread/[id]/page.tsx");
    const promptInput = read("components/ai-elements/prompt-input/prompt-input.tsx");

    expect(threadPage).toContain("isAwaitingAgent");
    expect(threadPage).toContain("disabled={isInputBusy}");
    expect(threadPage).toContain('status={isInputBusy ? "submitted" : undefined}');
    expect(promptInput).toContain("submittingRef");
    expect(promptInput).toContain("if (submittingRef.current)");
  });

  it("renders generated agent attachments so COIs can be previewed", () => {
    const threadPage = read("app/agent/thread/[id]/page.tsx");

    expect(threadPage).toContain("msg.attachments && msg.attachments.length > 0");
    expect(threadPage).toContain("<ThreadAttachmentChip key={i} attachment={att} threadId={msg.threadId} />");
  });
});
