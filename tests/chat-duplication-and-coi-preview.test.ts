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

  it("queues steering messages and allows sending immediately to cancel in-flight work", () => {
    const threadPage = read("app/agent/thread/[id]/page.tsx");
    const threads = read("convex/threads.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const aiUtils = read("convex/lib/aiUtils.ts");
    const promptInput = read("components/ai-elements/prompt-input/prompt-input.tsx");

    expect(threadPage).toContain("disabled={isInputBusy}");
    expect(threadPage).toContain("QueuedThreadMessage");
    expect(threadPage).toContain("setQueuedMessage(message)");
    expect(threadPage).toContain("sendQueuedNow");
    expect(threadPage).toContain("const isInputBusy = isSubmitting || sendingQueuedNow");
    expect(threadPage).toContain("if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow) return");
    expect(threadPage).toContain('const inputBusyLabel = "Sending"');
    expect(threads).toContain('message.status !== "processing"');
    expect(threads).toContain('content: "Response cancelled."');
    expect(processThreadChat).toContain("latestUserMessage");
    expect(processThreadChat).toContain("isAgentResponseCancelled");
    expect(processThreadChat).toContain('m.status !== "processing"');
    expect(processThreadChat).toContain('m.status !== "cancelled"');
    expect(aiUtils).toContain('msg.status === "processing" || msg.status === "cancelled"');
    expect(promptInput).toContain("submittingRef");
    expect(promptInput).toContain("if (submittingRef.current)");
  });

  it("leaves cancelled agent responses terminal so the composer does not wait forever", () => {
    const threads = read("convex/threads.ts");

    expect(threads).toContain('content: "Response cancelled."');
    expect(threads).toContain('status: "cancelled"');
    expect(threads).toContain('if (existing?.status === "cancelled") return');
    const cancelSection = threads.slice(
      threads.indexOf("export const cancelProcessing"),
      threads.indexOf("export const retryAgentResponse"),
    );
    expect(cancelSection).not.toContain("ctx.db.delete");
  });

  it("renders generated agent attachments so COIs can be previewed", () => {
    const threadPage = read("app/agent/thread/[id]/page.tsx");

    expect(threadPage).toContain("msg.attachments && msg.attachments.length > 0");
    expect(threadPage).toContain("<ThreadAttachmentChip key={i} attachment={att} threadId={msg.threadId} />");
  });

  it("gives the agent a browser-backed email preview rendering tool", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const renderer = read("convex/actions/renderEmailPreview.ts");
    const pkg = read("package.json");

    expect(chatTools).toContain("export const renderEmailPreview = tool");
    expect(chatTools).toContain("screenshot, print, preview, inspect formatting");
    expect(processThreadChat).toContain("render_email_preview");
    expect(processThreadChat).toContain("internal.actions.renderEmailPreview.run");
    expect(processThreadChat).toContain('lastToolName === "render_email_preview"');
    expect(renderer).toContain('loadPlaywright("playwright")');
    expect(renderer).toContain("ctx.storage.store");
    expect(pkg).toContain('"playwright"');
  });

  it("shows the email draft artifact every time a message references that draft", () => {
    const threadPage = read("app/agent/thread/[id]/page.tsx");
    const pendingEmails = read("convex/pendingEmails.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    const pendingEmailLinkBlock = threadPage.slice(
      threadPage.indexOf("if (message.pendingEmailId)"),
      threadPage.indexOf("const recipient = getEmailStatusRecipient(message);"),
    );
    expect(pendingEmailLinkBlock).toContain("candidate.pendingEmailId === message.pendingEmailId");
    expect(pendingEmailLinkBlock).not.toContain("attachedEmailMessageIds.has");
    expect(pendingEmails).toContain("return restored ? { id: args.id } : null");
    expect(processThreadChat).toContain("pendingEmailId: restored?.id");
  });
});
