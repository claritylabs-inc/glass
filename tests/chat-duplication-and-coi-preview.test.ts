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
    expect(schema).toContain("agentRunStartedAt: v.optional(v.number())");
    expect(schema).toContain('.index("by_replyToMessageId", ["replyToMessageId"])');
    expect(threads).toContain("export const claimAgentResponse = internalMutation");
    expect(threads).toContain("agentMessage.agentRunStartedAt");
    expect(threads).toContain('withIndex("by_replyToMessageId"');
    expect(processThreadChat).toContain("internal.threads.claimAgentResponse");
    expect(processThreadChat).toContain("agentMessageId: args.agentMessageId");
    expect(processThreadChat).toContain("if (!claim.claimed) return");
  });

  it("uses client mutation ids so local-first retries do not duplicate chat work", () => {
    const schema = read("convex/schema.ts");
    const threads = read("convex/threads.ts");
    const appSidebar = read("components/app-sidebar.tsx");
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const commandPalette = read("components/command-palette.tsx");
    const startAgentThread = read("hooks/use-start-agent-thread.ts");

    expect(schema).toContain("clientMutationId: v.optional(v.string())");
    expect(schema).toContain('.index("by_orgId_clientMutationId", ["orgId", "clientMutationId"])');
    expect(threads).toContain("args.clientMutationId");
    expect(threads).toContain('withIndex("by_orgId_clientMutationId"');
    expect(threads).toContain("agentMessageId");
    expect(appSidebar).toContain("createClientMutationId(\"thread\")");
    expect(threadContent).toContain("createClientMutationId(\"message\")");
    expect(commandPalette).toContain("useStartAgentThread(\"commandPalette\")");
    expect(startAgentThread).toContain("createClientMutationId(\"thread\")");
    expect(startAgentThread).toContain("createClientMutationId(\"message\")");
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
    expect(threadContent).toContain("if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow)");
    expect(threadContent).toContain("return;");
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
    expect(threadContent).toContain("assistantPdfAttachments");
    expect(threadContent).toContain('message.channel === "email"');
    expect(threadContent).toContain('attachment.contentType === "application/pdf"');
    expect(threadContent).toContain("seenAssistantPdfKeys");
    expect(threadContent).toContain('useMediaQuery("(min-width: 1024px)")');
    expect(threadContent).toContain("pdf.openWithUrl(autoOpenPdfUrl)");
  });

  it("reads common file attachments for agent context by filename and content type", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const threadPrompt = read("lib/thread-prompt.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");
    const spreadsheetText = read("convex/lib/spreadsheetText.ts");
    const packageJson = read("package.json");

    expect(threadContent).toContain("uploadPromptFiles");
    expect(threadPrompt).toContain("function inferAttachmentContentType");
    expect(threadPrompt).toContain('lowerName.endsWith(".csv")');
    expect(threadPrompt).toContain('"text/csv"');
    expect(threadPrompt).toContain('lowerName.endsWith(".xlsx")');
    expect(threadPrompt).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(threadPrompt).toContain('lowerName.endsWith(".docx")');
    expect(threadPrompt).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(threadPrompt).toContain('lowerName.endsWith(".pptx")');
    expect(threadPrompt).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(threadPrompt).toContain('lowerName.endsWith(".jpg")');
    expect(threadPrompt).toContain('"image/png"');
    expect(processThreadChat).toContain("function isTextLikeAttachment");
    expect(processThreadChat).toContain("function isPdfAttachment");
    expect(processThreadChat).toContain("function isImageAttachment");
    expect(processThreadChat).toContain("isXlsxSpreadsheetAttachment");
    expect(processThreadChat).toContain("isUnsupportedSpreadsheetAttachment");
    expect(processThreadChat).toContain("function isDocxAttachment");
    expect(processThreadChat).toContain("function isPresentationAttachment");
    expect(processThreadChat).toContain("spreadsheetBufferToText");
    expect(processThreadChat).toContain("docxBufferToText");
    expect(processThreadChat).toContain("pptxBufferToText");
    expect(processThreadChat).toContain("buildMessageHistoryWithAttachmentContext");
    expect(processThreadChat).toContain("RECENT_ATTACHMENT_MESSAGE_LIMIT");
    expect(processThreadChat).toContain('lowerName.endsWith(".csv")');
    expect(processThreadChat).toContain("Unsupported spreadsheet attachment");
    expect(processThreadChat).toContain('lowerName.endsWith(".docx")');
    expect(processThreadChat).toContain('lowerName.endsWith(".pptx")');
    expect(processThreadChat).toContain("isImageAttachment(att.filename, att.contentType)");
    expect(processThreadChat).toContain("isPdfAttachment(att.filename, att.contentType)");
    expect(processThreadChat).toContain('type.includes("csv")');
    expect(processThreadChat).not.toContain("XLSX.read");
    expect(processThreadChat).not.toContain("sheet_to_csv");
    expect(spreadsheetText).toContain("read-excel-file/node");
    expect(spreadsheetText).toContain("function isXlsxSpreadsheetAttachment");
    expect(spreadsheetText).toContain(
      "function isUnsupportedSpreadsheetAttachment",
    );
    expect(spreadsheetText).toContain('lowerName.endsWith(".xlsx")');
    expect(spreadsheetText).toContain("spreadsheetRowsToCsv");
    expect(spreadsheetText).toContain("readXlsxFile(buffer)");
    expect(spreadsheetText).not.toContain("XLSX.read");
    expect(spreadsheetText).not.toContain("sheet_to_csv");
    expect(packageJson).toContain("read-excel-file");
    expect(packageJson).not.toContain('"xlsx"');
    expect(processThreadChat).toContain("mammoth.extractRawText");
    expect(processThreadChat).toContain("JSZip.loadAsync");
    expect(processThreadChat).toContain("buffer.toString(\"utf-8\")");
  });

  it("does not let chat claim COI emails were sent without side-effect tools", () => {
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(processThreadChat).toContain("function hasCoiEmailIntent");
    expect(processThreadChat).toContain("function claimsCoiEmailCompletion");
    expect(processThreadChat).toContain("completedCoiEmailSideEffect");
    expect(processThreadChat).toContain("function hasEmailSendIntent");
    expect(processThreadChat).toContain("function claimsEmailSendCompletion");
    expect(processThreadChat).toContain("completedEmailSend");
    expect(processThreadChat).toContain("I haven't sent the email");
    expect(processThreadChat).toContain("usedTools.includes(\"email_expert\")");
    expect(processThreadChat).toContain("usedTools.includes(\"generate_coi\")");
    expect(processThreadChat).toContain("I haven't generated or emailed those COIs yet");
    expect(processThreadChat).toContain("function claimsEmailDraftCompletion");
    expect(processThreadChat).toContain("drafted|prepared|created|updated|revised");
    expect(processThreadChat).toContain("I haven't created an email draft yet");
  });

  it("names generated COI files by holder and policy and keeps unrelated uploads out of COI emails", () => {
    const generateCoi = read("convex/actions/generateCoi.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");
    const emailSubagent = read("convex/lib/emailSubagent.ts");

    expect(generateCoi).toContain("function buildCoiFileName");
    expect(generateCoi).toContain("CERTIFICATE_FORM_FILE_SLUGS");
    expect(generateCoi).toContain("${form} - ${holder} - ${policyRef}.pdf");
    expect(agentToolExecutors).toContain("filename: generated.fileName");
    expect(emailSubagent).toContain("buildAgentToolExecutors");
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
    const webControls = read("convex/lib/webChatDeterministicControls.ts");
    const commandExecutor = read("convex/lib/emailCommandExecutor.ts");

    const pendingEmailLinkBlock = threadContent.slice(
      threadContent.indexOf("if (message.pendingEmailId)"),
      threadContent.indexOf("const recipient = getEmailStatusRecipient(message);"),
    );
    expect(pendingEmailLinkBlock).toContain("candidate.pendingEmailId === message.pendingEmailId");
    expect(pendingEmailLinkBlock).toContain("!attachedEmailMessageIds.has(linked._id)");
    expect(pendingEmails).toContain("return restored ? { id: args.id } : null");
    expect(commandExecutor).toContain("pendingEmailId: restored?.id");
    expect(webControls).toContain("pendingEmailId: result.pendingEmailId");
  });

  it("shows email attachments as a compact labeled section", () => {
    const emailArtifact = read("components/agent-thread/artifacts/email.tsx");

    expect(emailArtifact).toContain("function EmailHeaderAttachments");
    expect(emailArtifact).toContain("col-span-1 pt-0.5");
    expect(emailArtifact).toContain("col-span-1 min-w-0");
    expect(emailArtifact).toContain('size="compact"');
    expect(emailArtifact).toContain("visibleAttachments");
    expect(emailArtifact).toContain("Attachments");
  });
});
