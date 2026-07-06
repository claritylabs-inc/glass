import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  resolveEmailAgentIdentity,
} from "../convex/lib/emailSubagent";
import { explicitlyRequestsCoiBatchForOneEmail } from "../convex/lib/coiAttachmentGuards";
import { isBrokerDirectedEmailRequest } from "../convex/lib/emailIntentGuards";
import {
  getAgentDomains,
  getAuthFromAddress,
  getNotificationFromAddress,
  isGlassOutboundAddress,
} from "../convex/lib/resend";
import { getAuthSiteUrl, getPortalUrlForOrg } from "../convex/lib/domains";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
} from "../convex/lib/emailCancelIntent";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("directed email sending", () => {
  it("falls back to the default agent handle when no custom handle is configured", async () => {
    const ctx = {
      runQuery: async () => null,
      storage: { getUrl: async () => null },
    };

    const identity = await resolveEmailAgentIdentity(ctx as never, {
      name: "Standalone Client",
      type: "client",
    });

    expect(identity.canSend).toBe(true);
    expect(identity.agentAddress).toBe("agent@glass.insure");
    expect(identity.fromHeader).toContain("<agent@glass.insure>");
  });

  it("uses separated primary email domains while preserving legacy inbound agent domains", () => {
    expect(getNotificationFromAddress("Glass Notifications")).toContain(
      "<notifications@notifications.glass.insure>",
    );
    expect(getAuthFromAddress()).toContain("<noreply@auth.glass.insure>");
    expect(getAgentDomains()).toEqual([
      "glass.insure",
      "glass.claritylabs.inc",
      "dev.claritylabs.inc",
    ]);
    expect(isGlassOutboundAddress("agent@glass.claritylabs.inc")).toBe(true);
    expect(isGlassOutboundAddress("noreply@auth.glass.insure")).toBe(true);
  });

  it("normalizes explicit legacy dev agent domains while preserving legacy inbound aliases", () => {
    withEnv(
      {
        AGENT_DOMAIN: "dev.claritylabs.inc",
        AGENT_EMAIL_DOMAIN: undefined,
        NOTIFICATION_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_FROM: "Glass Login <noreply@dev.claritylabs.inc>",
      },
      () => {
        expect(getAgentDomains()).toEqual([
          "glass.insure",
          "glass.claritylabs.inc",
          "dev.claritylabs.inc",
        ]);
        expect(getNotificationFromAddress("Glass Notifications")).toContain(
          "<notifications@dev.claritylabs.inc>",
        );
        expect(getAuthFromAddress()).toBe(
          "Glass Login <noreply@dev.claritylabs.inc>",
        );
        expect(isGlassOutboundAddress("agent@dev.claritylabs.inc")).toBe(true);
      },
    );
  });

  it("uses one browser app host for auth links and broker/client app links", () => {
    expect(getAuthSiteUrl()).toBe("https://app.glass.insure");
    expect(getPortalUrlForOrg({ type: "broker" } as never)).toBe(
      "https://app.glass.insure",
    );
    expect(getPortalUrlForOrg({ type: "client" } as never)).toBe(
      "https://app.glass.insure",
    );
  });

  it("passes the current user email as the default recipient for email-me requests", () => {
    const webSource = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );
    const smsSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(webSource).toContain(": user?.email");
    expect(webSource).toContain(": user?.name");
    expect(smsSource).toContain(": user.email");
    expect(smsSource).toContain(": user.name");
  });

  it("defaults requester bcc on and passes it to sms and web email sends", () => {
    const settingsSource = readFileSync(
      join(__dirname, "..", "components/settings/broker-agent-tab.tsx"),
      "utf-8",
    );
    const webSource = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );
    const smsSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(settingsSource).toContain("useState(true)");
    expect(settingsSource).toContain("org.bccRequesterOnAgentEmails ?? true");
    expect(settingsSource).toContain("bccRequesterOnAgentEmails,");
    expect(settingsSource).toContain("SettingsSwitch");
    expect(webSource).toContain("defaultBcc:");
    expect(webSource).toContain("org.bccRequesterOnAgentEmails !== false");
    expect(smsSource).toContain("defaultBcc:");
    expect(smsSource).toContain("org.bccRequesterOnAgentEmails !== false");
  });

  it("shows the agent settings section for standalone clients only", () => {
    const settingsPageSource = readFileSync(
      join(__dirname, "..", "app/settings/page.tsx"),
      "utf-8",
    );
    const sidebarSource = readFileSync(
      join(__dirname, "..", "components/app-sidebar.tsx"),
      "utf-8",
    );
    const agentTabSource = readFileSync(
      join(__dirname, "..", "components/settings/broker-agent-tab.tsx"),
      "utf-8",
    );

    expect(settingsPageSource).toContain("isStandaloneClient");
    expect(settingsPageSource).toContain('section.id !== "agent"');
    expect(settingsPageSource).toContain("section === \"agent\" && isStandaloneClient");
    expect(sidebarSource).toContain("isStandaloneClient");
    expect(sidebarSource).toContain("isStandaloneClient={isStandaloneClient}");
    expect(agentTabSource).toContain('org?.type === "broker"');
    expect(agentTabSource).toContain("Agent email address");
    expect(agentTabSource).toContain('aria-disabled="true"');
    expect(agentTabSource).toContain("cursor-not-allowed");
  });

  it("surfaces all email expert outcomes in web chat and sms", () => {
    const webSource = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );
    const smsSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(webSource).toContain("if (emailResult) {");
    expect(webSource).toContain("Review it in the email draft card");
    expect(smsSource).toContain("if (emailResult) {");
    expect(smsSource).toContain("responseText = emailResult.responseBody;");
  });

  it("uses a durable web email draft artifact with UI send fallback", () => {
    const threadPageSource = readFileSync(
      join(__dirname, "..", "app/agent/thread/[id]/page.tsx"),
      "utf-8",
    );
    const threadSource = readFileSync(
      join(__dirname, "..", "components/agent-thread/thread-content.tsx"),
      "utf-8",
    );
    const emailArtifactSource = readFileSync(
      join(__dirname, "..", "components/agent-thread/artifacts/email.tsx"),
      "utf-8",
    );
    const processSource = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );
    const webChatControlsSource = readFileSync(
      join(__dirname, "..", "convex/lib/webChatDeterministicControls.ts"),
      "utf-8",
    );
    const commandExecutorSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailCommandExecutor.ts"),
      "utf-8",
    );
    const subagentSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailSubagent.ts"),
      "utf-8",
    );
    const draftArtifactsSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailDraftArtifacts.ts"),
      "utf-8",
    );
    const senderSource = readFileSync(
      join(__dirname, "..", "convex/actions/sendPendingEmail.ts"),
      "utf-8",
    );
    const pendingEmailsSource = readFileSync(
      join(__dirname, "..", "convex/pendingEmails.ts"),
      "utf-8",
    );
    const cancelIntentSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailCancelIntent.ts"),
      "utf-8",
    );
    const imessageSource = readFileSync(
      join(__dirname, "..", "convex/lib/imessageDeterministicControls.ts"),
      "utf-8",
    );

    expect(subagentSource).toContain("upsertEmailDraftArtifact");
    expect(draftArtifactsSource).toContain("findDraftByThreadAndRecipient");
    expect(draftArtifactsSource).toContain("attachPendingEmailToAgentMessage");
    expect(processSource).toContain("runWebChatEmailControls");
    expect(webChatControlsSource).toContain("executeEmailCommand");
    expect(commandExecutorSource).toContain("sendDraftInternal");
    expect(webChatControlsSource).toContain("resolveTextChannelEmailControl");
    expect(commandExecutorSource).toContain(
      "pendingEmailCancelConfirmationMessage",
    );
    expect(webChatControlsSource).toContain(
      "isPendingEmailCancelConfirmationPrompt",
    );
    expect(commandExecutorSource).toContain("restoreAsDraftInternal");
    expect(cancelIntentSource).toContain("isPendingEmailCancelIntent");
    expect(cancelIntentSource).toContain('/^(cancel|undo|stop|abort|nevermind|never mind|hold on|wait|no)$/');
    expect(cancelIntentSource).toContain("isPendingEmailRestoreIntent");
    expect(cancelIntentSource).not.toContain("\\b(cancel|undo|stop|don'?t send|abort");
    expect(webChatControlsSource).not.toContain(
      "\\b(cancel|undo|stop|don'?t send|abort",
    );
    expect(imessageSource).toContain("isPendingEmailCancelConfirmationPrompt");
    expect(imessageSource).toContain("executeEmailCommand");
    expect(commandExecutorSource).toContain("restoreAsDraftInternal");
    expect(emailArtifactSource).toContain("restoreAsDraft");
    expect(emailArtifactSource).toContain("Restore draft");
    expect(processSource).toContain("`${content.trim()}\\n\\n${draftNotice}`");
    expect(emailArtifactSource).toContain("sendDraftNow");
    expect(emailArtifactSource).toContain("sendDraftsNow");
    expect(threadSource).toContain("EmailStackCard");
    expect(emailArtifactSource).toContain("Send all");
    expect(emailArtifactSource).toContain("Send Email");
    expect(emailArtifactSource).toContain("Review draft");
    expect(emailArtifactSource).toContain("View sent email");
    expect(threadSource).toContain("relatedEmailMessages");
    expect(threadSource).toContain("attachedEmailMessageIds");
    expect(threadSource).toContain("findRelatedEmailMessages");
    expect(threadSource).toContain("hiddenStatusMessageIds");
    expect(threadSource).toContain("lastAutoOpenedEmailId");
    expect(senderSource).toContain("updateChatMessage: false");
    expect(senderSource).toContain("pendingEmailId: id");
    expect(pendingEmailsSource).toContain('content: "Email cancelled."');
    expect(pendingEmailsSource).toContain("pendingEmailId: args.id");
    expect(pendingEmailsSource).not.toContain("pendingEmailId: undefined");
    expect(threadPageSource).toContain("UnifiedThreadContent");
  });

  it("does not treat cancellation-related document requests as email-cancel commands", () => {
    expect(
      isPendingEmailCancelIntent(
        "can you attach the cancellation email itself as an attachment?",
      ),
    ).toBe(false);
    expect(isPendingEmailCancelIntent("cancel")).toBe(true);
    expect(isPendingEmailCancelIntent("don't send")).toBe(true);
    expect(isPendingEmailCancelConfirmation("yes, cancel")).toBe(true);
    expect(isPendingEmailRestoreIntent("undo cancel")).toBe(true);
    expect(isPendingEmailRestoreIntent("restore the draft")).toBe(true);
  });

  it("keeps cc and bcc as structured email expert inputs", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/lib/emailSubagent.ts"),
      "utf-8",
    );
    const deliverySource = readFileSync(
      join(__dirname, "..", "convex/lib/emailDelivery.ts"),
      "utf-8",
    );

    expect(source).toContain("cc: z.array(z.string()).optional()");
    expect(source).toContain("bcc: z.array(z.string()).optional()");
    expect(deliverySource).toContain("payload.bcc = params.bcc");
    expect(source).toContain('If the request says "email me"');
    expect(source).not.toContain("Confirm the recipient name.");
  });

  it("keeps certificate-only email drafts to a single generated COI attachment", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/lib/emailSubagent.ts"),
      "utf-8",
    );
    const sendPendingSource = readFileSync(
      join(__dirname, "..", "convex/actions/sendPendingEmail.ts"),
      "utf-8",
    );
    const coiGuardsSource = readFileSync(
      join(__dirname, "..", "convex/lib/coiAttachmentGuards.ts"),
      "utf-8",
    );
    const threadsSource = readFileSync(
      join(__dirname, "..", "convex/threads.ts"),
      "utf-8",
    );

    expect(source).toContain("suppressOriginalPolicyForCoiRequest");
    expect(source).toContain("Generated COI is already attached.");
    expect(source).toContain("For certificate/COI delivery requests, attach only the generated COI");
    expect(source).toContain("do not include original_policy unless the user separately asked");
    expect(source).toContain("excludeEmailArtifacts: true");
    expect(source).toContain("excludeAgentCoiAttachments: suppressOriginalPolicyForCoiRequest");
    expect(source).toContain("generatedCoiAttachmentIds");
    expect(source).toContain("each recipient's email must include only that recipient's generated COI");
    expect(source).toContain("explicitly asks to bundle all COIs/certificates into one email");
    expect(source).toContain("allowMultipleCoiAttachments");
    expect(source).toContain("resolveRequestedCoiAttachmentsForRecipient");
    expect(coiGuardsSource).toContain("A single recipient email was given multiple COI attachments");
    expect(sendPendingSource).toContain("pending.allowMultipleCoiAttachments");
    expect(threadsSource).toContain("excludeEmailArtifacts: v.optional(v.boolean())");
    expect(threadsSource).toContain("excludeAgentCoiAttachments: v.optional(v.boolean())");
    expect(threadsSource).toContain('message.channel === "email"');
    expect(sendPendingSource).toContain("assertSafeDraftAttachments(pending)");
    expect(sendPendingSource).toContain("shouldBlockUnapprovedCoiAttachmentBatch");
    expect(sendPendingSource).toContain("too many certificate attachments");
  });

  it("allows explicit single-email COI bundle requests", () => {
    expect(
      explicitlyRequestsCoiBatchForOneEmail(
        "Yes can you attach all five COIs and send them to adyan@cove.dev",
      ),
    ).toBe(true);
    expect(
      explicitlyRequestsCoiBatchForOneEmail(
        "Send all 5 certificates together in one email",
      ),
    ).toBe(true);
    expect(
      explicitlyRequestsCoiBatchForOneEmail(
        "Send each holder their certificate separately",
      ),
    ).toBe(false);
  });

  it("centralizes broker-directed email intent detection", () => {
    expect(isBrokerDirectedEmailRequest("Can you send this to my broker?")).toBe(true);
    expect(isBrokerDirectedEmailRequest("Please draft an email for our broker")).toBe(true);
    expect(isBrokerDirectedEmailRequest("Send this to adyan@example.com")).toBe(false);
  });

  it("revises multi-draft COI batches in place instead of updating one draft", () => {
    const processThreadChat = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(processThreadChat).toContain("isMultiDraftElaborationRequest");
    expect(processThreadChat).toContain("currentDraftEmails.length > 1");
    expect(processThreadChat).toContain("selectSafeDraftAttachments");
    expect(processThreadChat).toContain("I also repaired");
    expect(processThreadChat).toContain("buildElaboratedCoiDraftBody");
  });

  it("uses text summaries for multiple email draft workflows outside web cards", () => {
    const summarySource = readFileSync(
      join(__dirname, "..", "convex/lib/emailDraftSummary.ts"),
      "utf-8",
    );
    const imessageSource = readFileSync(
      join(__dirname, "..", "convex/lib/imessageDeterministicControls.ts"),
      "utf-8",
    );
    const inboundEmailSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundEmail.ts"),
      "utf-8",
    );
    const inboundEmailControlsSource = readFileSync(
      join(__dirname, "..", "convex/lib/inboundEmailDeterministicControls.ts"),
      "utf-8",
    );
    const commandExecutorSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailCommandExecutor.ts"),
      "utf-8",
    );
    const httpSource = readFileSync(
      join(__dirname, "..", "convex/http.ts"),
      "utf-8",
    );
    const emailDraftsSource = readFileSync(
      join(__dirname, "..", "convex/actions/emailDrafts.ts"),
      "utf-8",
    );

    expect(summarySource).toContain("buildEmailDraftTextSummary");
    expect(summarySource).toContain("Sample:");
    expect(summarySource).toContain('Reply "show more"');
    expect(summarySource).toContain("isShowMoreEmailDraftIntent");
    expect(summarySource).toContain("isSendAllEmailDraftsIntent");
    expect(inboundEmailSource).toContain("runInboundEmailDeterministicControls");
    expect(inboundEmailControlsSource).toContain("resolveTextChannelEmailControl");
    expect(inboundEmailControlsSource).toContain("executeEmailCommand");
    expect(commandExecutorSource).toContain("sendDraftInternal");
    expect(commandExecutorSource).toContain("buildEmailDraftTextSummary");
    expect(imessageSource).toContain("resolveTextChannelEmailControl");
    expect(imessageSource).toContain("allowDraftList: true");
    expect(imessageSource).toContain("allowDraftSendAll: true");
    expect(inboundEmailSource).toContain("CURRENT EMAIL DRAFTS");
    expect(inboundEmailSource).toContain("show a short sample first");
    expect(httpSource).toContain("send_email_drafts");
    expect(httpSource).toContain("/mcp/email/drafts/send-batch");
    expect(emailDraftsSource).toContain("sendManyForMcp");
    expect(emailDraftsSource).toContain("summarizeForMcp");
  });

  it("requires inbound email sends to go through explicit tools, not assistant prose markers", () => {
    const inboundEmailSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundEmail.ts"),
      "utf-8",
    );
    const promptSource = readFileSync(
      join(__dirname, "..", "convex/lib/aiUtils.ts"),
      "utf-8",
    );

    expect(inboundEmailSource).toContain("email_expert: buildEmailExpertTool");
    expect(inboundEmailSource).not.toContain("const sendMatch = responseBody.match");
    expect(inboundEmailSource).not.toContain("Third-party email send failed");
    expect(promptSource).toContain("use the email expert tool or another explicit validated sending tool");
    expect(promptSource).not.toContain("exact send marker");
  });

  it("does not append policy source blocks to outbound emails", () => {
    const subagentSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailSubagent.ts"),
      "utf-8",
    );
    const inboundEmailSource = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundEmail.ts"),
      "utf-8",
    );

    expect(subagentSource).not.toContain("buildPolicySourcesHtml");
    expect(subagentSource).not.toContain("buildPolicySourcesText");
    expect(inboundEmailSource).not.toContain("buildPolicySourcesHtml");
    expect(inboundEmailSource).not.toContain("buildPolicySourcesText");
  });

  it("uses chat email notifications for normal web chat replies", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(source).toContain("org.chatEmailNotifications === true");
    expect(source).toContain("getNotificationFromAddress");
    expect(source).toContain("View thread");
  });

  it("sends an actual sms confirmation after delayed iMessage email sends complete", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/actions/sendPendingEmail.ts"),
      "utf-8",
    );

    expect(source).toContain("sendTextConfirmation");
    expect(source).toContain("thread?.threadPhone");
    expect(source).toContain("sendOutboundImessage");
    expect(source).toContain("Email sent to ${pending.recipientEmail}");
    expect(source).toContain("insertImessageMessage");
  });

  it("does not send separate canned iMessage policy status cues", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(source).not.toContain("generateImessageStatusCue");
    expect(source).not.toContain("I'll check the policy");
    expect(source).not.toContain("I'll check the attachment");
  });

  it("sends delayed iMessage email status before returning the inbound response", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(source).toContain('emailResult.status === "pending"');
    expect(source).toContain("sendImmediateImessage({");
    expect(source).toContain("pendingEmailId: emailResult.pendingEmailId");
    expect(source).toContain("responseAlreadySent ? \"\" : responseText");
  });

  it("uses the Glass logo and footer retry action on assistant chat bubbles", () => {
    const source = readFileSync(
      join(__dirname, "..", "components/agent-thread/thread-content.tsx"),
      "utf-8",
    );

    expect(source).toContain("LogoIcon");
    expect(source).not.toContain("Asterisk");
    expect(source).toContain("TryAgainMessageButton");
    expect(source).toContain('title="Try again"');
  });
});
