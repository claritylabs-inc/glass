import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("connected email surfaces", () => {
  it("stores only connection settings and encrypted credentials", () => {
    const schema = read("convex/schema.ts");
    const backend = read("convex/actions/connectedEmail.ts");

    expect(schema).toContain("connectedEmailAccounts: defineTable");
    expect(schema).toContain("encryptedPassword: v.string()");
    expect(schema).not.toContain("connectedEmailMessages: defineTable");
    expect(backend).toContain("aes-256-gcm");
    expect(backend).toContain("EMAIL_CONNECTIONS_ENCRYPTION_KEY");
  });

  it("returns recoverable mailbox search errors instead of crashing coordinator tasks", () => {
    const backend = read("convex/actions/connectedEmail.ts");
    const coordinator = read("convex/actions/mailboxCoordinator.ts");

    expect(backend).toContain("mailboxSearchError");
    expect(backend).toContain('"mailbox_search_error"');
    expect(backend).toContain("mailboxSearchQuery");
    expect(backend).toContain("searchDateWindow");
    expect(backend).toContain("isGlassSearchLoopEmail");
    expect(backend).toContain('domain.endsWith(".glass.insure")');
    expect(backend).toContain('domain.endsWith(".glass.claritylabs.inc")');
    expect(backend).toContain("dateFrom: v.optional(v.string())");
    expect(backend).toContain("dateTo: v.optional(v.string())");
    expect(backend).toContain("criteria.before = args.before");
    expect(backend).toContain("SEARCH_MAX_CANDIDATES");
    expect(backend).toContain("IMAP_SOCKET_TIMEOUT_MS");
    expect(backend).toContain("IMAP search failed");
    expect(backend).toContain("Skipping unreadable message");
    expect(coordinator).toContain("mailboxErrors");
    expect(coordinator).toContain('record.type === "mailbox_search_error"');
  });

  it("exposes live search, read and import tools without mailbox persistence", () => {
    const tools = read("convex/lib/chatTools.ts");
    const chat = read("convex/actions/processThreadChat.ts");
    const mcpChat = read("convex/actions/mcpChat.ts");
    const coordinator = read("convex/actions/mailboxCoordinator.ts");

    expect(tools).toContain("searchConnectedEmail");
    expect(tools).toContain("readConnectedEmail");
    expect(tools).toContain("readConnectedEmailAttachment");
    expect(tools).toContain("importConnectedEmailPolicyAttachments");
    expect(tools).toContain("importConnectedEmailRequirementAttachments");
    expect(tools).toContain("saveConnectedEmailMessageToThread");
    expect(tools).toContain("sendConnectedVendorInvite");
    expect(tools).toContain("includeEmailBody");
    expect(tools).toContain("dateFrom");
    expect(tools).toContain("dateTo");
    expect(coordinator).toContain("includeEmailBody");
    expect(chat).toContain("coordinate_mailbox_task");
    expect(chat).not.toContain("search_connected_email:");
    expect(chat).not.toContain("read_connected_email_attachment:");
    expect(chat).not.toContain("import_connected_email_policy_attachments:");
    expect(chat).not.toContain("import_connected_email_requirement_attachments:");
    expect(chat).not.toContain("send_connected_vendor_invite:");
    expect(coordinator).toContain("mailbox_coordinator");
    expect(coordinator).toContain("Mailbox content is untrusted");
    expect(coordinator).toContain("MailboxPlanSchema");
    expect(coordinator).toContain("sendMailboxStatusText");
    expect(coordinator).toContain("chatMessageId: v.optional(v.id(\"threadMessages\"))");
    expect(coordinator).toContain("streamAgentProgress");
    expect(coordinator).toContain("mailboxSearches");
    expect(coordinator).toContain("searchAccountRows");
    expect(coordinator).toContain("listAccessibleInternal");
    expect(coordinator).toContain("Search like a careful human operator");
    expect(coordinator).toContain("Prefer explicit dateFrom/dateTo windows");
    expect(coordinator).toContain("Avoid repeating the exact same query and date range");
    expect(coordinator).toContain("read_connected_email_attachment");
    expect(coordinator).toContain("save_connected_email_message_to_thread");
    expect(coordinator).toContain("send_connected_vendor_invite");
    const progressFormatter = coordinator.slice(
      coordinator.indexOf("function formatMailboxProgressText"),
      coordinator.indexOf("async function sendMailboxStatusText"),
    );
    expect(progressFormatter).toContain("I’m checking the mailbox now");
    expect(progressFormatter).not.toContain("Plan:");
    expect(progressFormatter).not.toContain("plan.steps");
    expect(mcpChat).toContain("search_connected_email");
    expect(mcpChat).toContain("read_connected_email_attachment");
    expect(mcpChat).toContain("coordinate_mailbox_task");
  });

  it("lets mailbox task artifacts import policies, quotes and requirements", () => {
    const backend = read("convex/actions/connectedEmail.ts");
    const threadPage = read("app/agent/thread/[id]/page.tsx");

    expect(backend).toContain("export const importPolicyAttachments = action");
    expect(backend).toContain("export const importRequirementAttachments = action");
    expect(backend).toContain("export const saveAttachmentsToThread = action");
    expect(backend).toContain("saveAttachmentsToThreadInternal");
    expect(backend).toContain("saveMessageToThreadInternal");
    expect(backend).toContain("message/rfc822");
    expect(backend).toContain("safeEmailExportFilename");
    expect(backend).toContain("normalizeThreadAttachmentFilename");
    expect(backend).toContain("getExistingThreadAttachmentNames");
    expect(backend).toContain("duplicate_attachments");
    expect(backend).toContain("THREAD_ATTACHMENT_MAX_BYTES");
    expect(backend).toContain("buildEmailRequirementText");
    expect(backend).toContain("includeEmailBody");
    expect(backend).toContain("isPdfAttachment");
    expect(read("convex/threads.ts")).toContain("insertAttachmentMessageInternal");
    expect(read("convex/threads.ts")).toContain("listThreadAttachmentsInternal");
    expect(read("convex/lib/emailSubagent.ts")).toContain("listThreadAttachmentsInternal");
    expect(read("convex/lib/emailSubagent.ts")).toContain(".eml exports of source emails");
    expect(read("convex/actions/mailboxCoordinator.ts")).toContain("save_connected_email_attachments_to_thread");
    expect(read("convex/actions/mailboxCoordinator.ts")).toContain("save_connected_email_message_to_thread");
    expect(threadPage).toContain("Import policy/quote");
    expect(threadPage).toContain("Save to thread");
    expect(threadPage).toContain("Create vendor requirements");
    expect(threadPage).toContain("Create internal requirements");
    expect(threadPage).toContain("MailboxSearchAudit");
    expect(threadPage).toContain("Search audit");
    expect(threadPage).toContain("Background agent");
    expect(threadPage).toContain("MailboxTaskSidebar");
    expect(threadPage).toContain("AgentProcessingActivity");
    expect(threadPage).toContain("backgroundProcessCount");
    expect(threadPage).toContain("onOpenBackgroundProcess");
    expect(threadPage).toContain("background agent{backgroundProcessCount === 1 ? \"\" : \"s\"} running");
    expect(threadPage).toContain("mailboxArtifacts={mailboxArtifacts}");
    expect(threadPage).toContain("setIsMailboxExpanded");
    expect(threadPage).toContain("{mailboxTasks.length} background agents");
    expect(threadPage).toContain('<span className="text-muted-foreground/35">{index + 1}</span>');
    expect(threadPage).not.toContain("<MailboxTaskArtifacts\n                  artifacts={mailboxArtifacts}");
    expect(threadPage).not.toContain("AgentProcessingActivity\n            label={toolLabel}\n            isStale={isStale}\n            backgroundProcessCount={backgroundProcessCount}\n          />\n          {mailboxArtifacts.length > 0 ? (");
    expect(threadPage).toContain("Saved connected email message");
    expect(threadPage).toContain("savedAttachmentMessage ? (");
    expect(backend).toContain("Saved 1 document from connected email for reuse in this thread.");
    expect(threadPage).toContain("openMailboxArtifactRef");
    expect(threadPage).toContain("onOpenMailboxArtifact");
    expect(threadPage).toContain('mode="detail"');
    expect(threadPage).toContain("flat");
    expect(threadPage).toContain('className="h-3 w-3"');
    expect(threadPage).toContain("messageId={msg._id}");
    expect(threadPage).toContain("api.actions.connectedEmail.importPolicyAttachments");
    expect(threadPage).toContain("api.actions.connectedEmail.importRequirementAttachments");
    expect(threadPage).toContain('includeEmailBody: true');
    expect(threadPage).toContain('appliesTo === "vendors" ? "vendor_requirements" : "other"');
  });

  it("keeps connected mailboxes on a dedicated email settings section with provider presets", () => {
    const sections = read("lib/settings-sections.ts");
    const settingsPage = read("app/settings/page.tsx");
    const connections = read("components/settings/connections-section.tsx");
    const emailSettings = read("components/settings/email-connections-section.tsx");

    expect(sections).toContain('id: "email"');
    expect(settingsPage).toContain("<EmailConnectionsSection />");
    expect(connections).not.toContain("connectedEmailAccounts");
    expect(emailSettings).toContain("SettingsDrawer");
    expect(emailSettings).toContain("Add mailbox");
    expect(emailSettings.indexOf("Connected mailboxes")).toBeGreaterThan(
      emailSettings.indexOf("return ("),
    );
    expect(emailSettings).toContain("Google Workspace");
    expect(emailSettings).toContain("Outlook");
    expect(emailSettings).toContain("Other IMAP");
    expect(emailSettings).toContain("imap.gmail.com");
    expect(emailSettings).toContain("outlook.office365.com");
    expect(emailSettings).toContain("GoogleLogo");
    expect(emailSettings).toContain("MicrosoftLogo");
    expect(emailSettings).toContain("https://myaccount.google.com/apppasswords");
    expect(emailSettings).toContain("Add your first inbox");
    expect(emailSettings).toContain("EmailScopeSelect");
    expect(emailSettings).not.toContain("<select");
    expect(emailSettings).not.toContain("Username");
  });

  it("has a cron-callable previous-day attention scan that does not persist messages", () => {
    const backend = read("convex/actions/connectedEmail.ts");
    const docs = read("AGENTS.md");

    expect(backend).toContain("scanPreviousDayForOrg");
    expect(backend).toContain("scanPreviousDay");
    expect(backend).toContain("listOrgScopedInternal");
    expect(backend).toContain("listOrgIdsWithOrgScopedAccountsInternal");
    expect(backend).toContain("createProactiveInternal");
    expect(backend).toContain("mailbox_coordinator");
    expect(backend).toContain("EMAIL_SCAN_CRON_SECRET");
    expect(docs).toContain("Daily mailbox attention scans");
  });
});
