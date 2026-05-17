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
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const threads = read("convex/threads.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const aiUtils = read("convex/lib/aiUtils.ts");
    const promptInput = read("components/ai-elements/prompt-input/prompt-input.tsx");

    expect(threadContent).toContain("disabled={isInputBusy}");
    expect(threadContent).toContain("QueuedThreadMessage");
    expect(threadContent).toContain("setQueuedMessage(message)");
    expect(threadContent).toContain("sendQueuedNow");
    expect(threadContent).toContain("const isInputBusy = isSubmitting || sendingQueuedNow");
    expect(threadContent).toContain("if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow) return");
    expect(threadContent).toContain('const inputBusyLabel = "Sending"');
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
    const threadContent = read("components/agent-thread/thread-content.tsx");

    expect(threadContent).toContain("msg.attachments && msg.attachments.length > 0");
    expect(threadContent).toContain("function ThreadAttachmentList");
    expect(threadContent).toContain("api.threads.getAttachmentUrls");
    expect(threadContent).toContain("Download all");
  });

  it("reads CSV attachments for agent context by filename and content type", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const appShell = read("components/app-shell.tsx");
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(threadContent).toContain('lowerName.endsWith(".csv")');
    expect(threadContent).toContain('"text/csv"');
    expect(appShell).toContain('lowerName.endsWith(".csv")');
    expect(appShell).toContain('"text/csv"');
    expect(processThreadChat).toContain("function isTextLikeAttachment");
    expect(processThreadChat).toContain("buildMessageHistoryWithAttachmentContext");
    expect(processThreadChat).toContain("RECENT_ATTACHMENT_MESSAGE_LIMIT");
    expect(processThreadChat).toContain('lowerName.endsWith(".csv")');
    expect(processThreadChat).toContain('type.includes("csv")');
    expect(processThreadChat).toContain('type === "application/vnd.ms-excel"');
    expect(processThreadChat).toContain("buffer.toString(\"utf-8\")");
  });

  it("does not let chat claim COI emails were sent without side-effect tools", () => {
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(processThreadChat).toContain("function hasCoiEmailIntent");
    expect(processThreadChat).toContain("function claimsCoiEmailCompletion");
    expect(processThreadChat).toContain("completedCoiEmailSideEffect");
    expect(processThreadChat).toContain("usedTools.includes(\"email_expert\")");
    expect(processThreadChat).toContain("usedTools.includes(\"generate_coi\")");
    expect(processThreadChat).toContain("I haven't generated or emailed those COIs yet");
    expect(processThreadChat).toContain("function claimsEmailDraftCompletion");
    expect(processThreadChat).toContain("I haven't created an email draft yet");
  });

  it("names generated COI files by holder and policy and keeps unrelated uploads out of COI emails", () => {
    const generateCoi = read("convex/actions/generateCoi.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const emailSubagent = read("convex/lib/emailSubagent.ts");

    expect(generateCoi).toContain("function buildCoiFileName");
    expect(generateCoi).toContain("COI - ${holder} - ${policyRef}.pdf");
    expect(processThreadChat).toContain("filename: generated.fileName");
    expect(emailSubagent).toContain("filename: generated.fileName");
    expect(emailSubagent).toContain("Skipped uploaded file because COI delivery requests should attach only the generated COI");
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
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const pendingEmails = read("convex/pendingEmails.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    const pendingEmailLinkBlock = threadContent.slice(
      threadContent.indexOf("if (message.pendingEmailId)"),
      threadContent.indexOf("const recipient = getEmailStatusRecipient(message);"),
    );
    expect(pendingEmailLinkBlock).toContain("candidate.pendingEmailId === message.pendingEmailId");
    expect(pendingEmailLinkBlock).toContain("!attachedEmailMessageIds.has(linked._id)");
    expect(pendingEmails).toContain("return restored ? { id: args.id } : null");
    expect(processThreadChat).toContain("pendingEmailId: restored?.id");
  });

  it("shows email attachments as a compact labeled section", () => {
    const emailArtifact = read("components/agent-thread/artifacts/email.tsx");

    expect(emailArtifact).toContain("function EmailHeaderAttachments");
    expect(emailArtifact).toContain("col-span-2 mt-2");
    expect(emailArtifact).toContain("Attachments");
  });
});
