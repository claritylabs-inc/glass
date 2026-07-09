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
    expect(backend).toContain("bodyStructure: true");
    expect(backend).toContain("AUTOMATION_TEXT_DOWNLOAD_MAX_BYTES");
    expect(backend).toContain("Mailbox scan was incomplete");
    expect(backend).toContain("AUTOMATION_INITIAL_LOOKBACK_DAYS = 400");
    expect(backend).toContain("AUTOMATION_HISTORY_SUBJECT_TERMS");
    expect(backend).toContain("downloaded.meta.expectedSize");
    expect(backend).toContain("args.filenames === undefined");
    expect(backend).toContain("importedComplianceAttentionAfterBatch");
    expect(backend).toContain("success && files.length > 1");
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

  it("lets mailbox task artifacts import policies and requirements", () => {
    const backend = read("convex/actions/connectedEmail.ts");
    const mailboxTask = read("components/agent-thread/artifacts/mailbox-task.tsx");
    const threadContent = read("components/agent-thread/thread-content.tsx");

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
    expect(mailboxTask).toContain("Import policy");
    expect(mailboxTask).toContain("Save to thread");
    expect(mailboxTask).toContain("Create vendor requirements");
    expect(mailboxTask).toContain("Create internal requirements");
    expect(mailboxTask).toContain("MailboxSearchAudit");
    expect(mailboxTask).toContain("Search audit");
    expect(mailboxTask).toContain("Background agent");
    expect(mailboxTask).toContain("MailboxTaskSidebar");
    expect(threadContent).toContain("AgentProcessingActivity");
    expect(threadContent).toContain("backgroundProcessCount");
    expect(threadContent).toContain("onOpenBackgroundProcess");
    expect(threadContent).toContain("background agent");
    expect(threadContent).toContain("mailboxArtifacts={mailboxArtifacts}");
    expect(threadContent).toContain("mailboxTaskDisplayName");
    expect(mailboxTask).toContain("Mailbox search - ${uniqueAccounts[0]}");
    expect(threadContent).toContain("setIsMailboxExpanded");
    expect(threadContent).toContain('label="Background agents"');
    expect(threadContent).toContain("count={mailboxTasks.length}");
    expect(threadContent).toContain('<span className="text-muted-foreground/35">{index + 1}</span>');
    expect(threadContent).not.toContain("<MailboxTaskArtifacts\n                  artifacts={mailboxArtifacts}");
    expect(threadContent).not.toContain("AgentProcessingActivity\n            label={toolLabel}\n            isStale={isStale}\n            backgroundProcessCount={backgroundProcessCount}\n          />\n          {mailboxArtifacts.length > 0 ? (");
    expect(backend).toContain("Saved 1 document from connected email for reuse in this thread.");
    expect(threadContent).toContain("openMailboxArtifactRef");
    expect(threadContent).toContain("onOpenMailboxArtifact");
    expect(mailboxTask).toContain('mode="detail"');
    expect(mailboxTask).toContain("flat");
    expect(mailboxTask).toContain('className="h-3 w-3"');
    expect(threadContent).toContain("messageId={msg._id}");
    expect(mailboxTask).toContain("api.actions.connectedEmail.importPolicyAttachments");
    expect(mailboxTask).toContain("api.actions.connectedEmail.importRequirementAttachments");
    expect(mailboxTask).toContain('includeEmailBody: true');
    expect(mailboxTask).toContain('scope === "vendors" ? "vendor_requirements" : "other"');
  });

  it("keeps connected mailboxes on a dedicated email settings section with provider presets", () => {
    const sections = read("lib/settings-sections.ts");
    const settingsPage = read("app/settings/page.tsx");
    const connections = read("components/settings/connections-section.tsx");
    const emailList = read("components/settings/email-connections-section.tsx");
    const emailDrawers = read("components/settings/email-connection-drawers.tsx");
    const emailUi = read("components/settings/email-connection-ui.tsx");
    const emailSettings = [emailList, emailDrawers, emailUi].join("\n");

    expect(sections).toContain('id: "email"');
    expect(settingsPage).toContain("<EmailConnectionsSection />");
    expect(connections).not.toContain("connectedEmailAccounts");
    expect(emailDrawers).toContain("SettingsDrawer");
    expect(emailSettings).toContain("Add mailbox");
    expect(emailList.indexOf("Connected mailboxes")).toBeGreaterThan(
      emailList.indexOf("return ("),
    );
    expect(emailSettings).toContain("Google Workspace");
    expect(emailSettings).toContain("Outlook");
    expect(emailSettings).toContain("Other IMAP");
    expect(emailSettings).toContain("imap.gmail.com");
    expect(emailSettings).toContain("outlook.office365.com");
    expect(emailSettings).toContain("GoogleLogo");
    expect(emailSettings).toContain("MicrosoftLogo");
    expect(emailSettings).toContain("https://myaccount.google.com/apppasswords");
    expect(emailSettings).toContain("Connect your first mailbox");
    expect(emailSettings).toContain("EmailScopeSelect");
    expect(emailSettings).toContain("canManageOrgMailboxes");
    expect(emailSettings).toContain("allowOrgScope={canManageOrgMailboxes}");
    expect(emailSettings).toContain("api.connectedEmail.updateSettings");
    expect(emailSettings).toContain("automationConfigured");
    expect(emailSettings).toContain("Policy documents");
    expect(emailSettings).toContain("Insurance requirements");
    expect(emailSettings).toContain("Company context");
    expect(emailList).toContain("setSelectedAccountId(account._id)");
    expect(emailList).not.toContain("updateConnectedEmailScope");
    expect(emailList).not.toContain("revokeConnectedEmail");
    expect(emailSettings).not.toContain("<select");
    expect(emailSettings).not.toContain("Username");
  });

  it("guards connected email IMAP destinations and org-scoped mailboxes", () => {
    const action = read("convex/actions/connectedEmail.ts");
    const mutation = read("convex/connectedEmail.ts");
    const guard = read("convex/lib/imapDestination.ts");

    expect(action).toContain("resolveImapDestination");
    expect(action).toContain("destination.normalizedHost");
    expect(action).toContain("Only org admins can connect organization-scoped mailboxes");
    expect(guard).toContain("Connected email supports IMAP ports 993 and 143 only");
    expect(guard).toContain("IMAP host resolves to a private or reserved network address");
    expect(guard).toContain("BlockList");
    expect(mutation).toContain(
      "Only org admins can make a mailbox available to the organization",
    );
  });

  it("has a cron-callable previous-day attention scan that does not persist messages", () => {
    const backend = read("convex/actions/connectedEmail.ts");
    const docs = read("AGENTS.md");

    expect(backend).toContain("scanPreviousDayForOrg");
    expect(backend).toContain("scanPreviousDay");
    expect(backend).toContain("listAutomationEligibleForOrgInternal");
    expect(backend).toContain("listAutomationEligibleInternal");
    expect(backend).toContain("createProactiveInternal");
    expect(backend).toContain("mailbox_coordinator");
    expect(backend).toContain("EMAIL_SCAN_CRON_SECRET");
    expect(docs).toContain("connected-mailbox automation");
  });
});
