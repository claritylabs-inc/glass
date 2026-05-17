import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resolveEmailAgentIdentity } from "../convex/lib/emailSubagent";
import {
  getAgentDomains,
  getAuthFromAddress,
  getNotificationFromAddress,
  isGlassOutboundAddress,
} from "../convex/lib/resend";
import { getAuthSiteUrl, getPortalUrlForOrg } from "../convex/lib/domains";
import { shouldSkipImessageStatusCueForEmailApproval } from "../convex/actions/handleInboundImessage";
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

  it("honors explicit legacy dev sending domains", () => {
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
          "dev.claritylabs.inc",
          "glass.claritylabs.inc",
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

    expect(webSource).toContain("defaultTo: user?.email");
    expect(webSource).toContain("defaultRecipientName: user?.name");
    expect(smsSource).toContain("defaultTo: user.email");
    expect(smsSource).toContain("defaultRecipientName: user.name");
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
    const subagentSource = readFileSync(
      join(__dirname, "..", "convex/lib/emailSubagent.ts"),
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
      join(__dirname, "..", "convex/actions/handleInboundImessage.ts"),
      "utf-8",
    );

    expect(subagentSource).toContain("upsertEmailDraftArtifact");
    expect(subagentSource).toContain("findDraftByThreadAndRecipient");
    expect(subagentSource).toContain("attachPendingEmailToAgentMessage");
    expect(processSource).toContain("sendDraftInternal");
    expect(processSource).toContain("isPendingEmailCancelIntent");
    expect(processSource).toContain("pendingEmailCancelConfirmationMessage");
    expect(processSource).toContain("isPendingEmailCancelConfirmationPrompt");
    expect(processSource).toContain("restoreAsDraftInternal");
    expect(cancelIntentSource).toContain('/^(cancel|undo|stop|abort|nevermind|never mind|hold on|wait|no)$/');
    expect(cancelIntentSource).toContain("isPendingEmailRestoreIntent");
    expect(cancelIntentSource).not.toContain("\\b(cancel|undo|stop|don'?t send|abort");
    expect(processSource).not.toContain("\\b(cancel|undo|stop|don'?t send|abort");
    expect(imessageSource).toContain("isPendingEmailCancelConfirmationPrompt");
    expect(imessageSource).toContain("pendingEmailCancelConfirmationMessage");
    expect(imessageSource).toContain("restoreAsDraftInternal");
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

    expect(source).toContain("cc: z.array(z.string()).optional()");
    expect(source).toContain("bcc: z.array(z.string()).optional()");
    expect(source).toContain("payload.bcc = params.bcc");
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
    expect(threadsSource).toContain("excludeEmailArtifacts: v.optional(v.boolean())");
    expect(threadsSource).toContain("excludeAgentCoiAttachments: v.optional(v.boolean())");
    expect(threadsSource).toContain('message.channel === "email"');
    expect(sendPendingSource).toContain("assertSafeDraftAttachments(pending)");
    expect(sendPendingSource).toContain("too many certificate attachments");
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
    expect(source).toContain("/send");
    expect(source).toContain("Email sent to ${pending.recipientEmail}");
    expect(source).toContain("insertImessageMessage");
  });

  it("does not send a separate iMessage status cue for email-send approvals", () => {
    const recentContext = [
      "Glass: Draft email to terry@example.com:",
      "",
      "To: terry@example.com",
      "Subject: Renewal request",
      "",
      "Ready to send?",
    ].join("\n");

    expect(shouldSkipImessageStatusCueForEmailApproval({
      messageText: "Yes this is good",
      recentContext,
    })).toBe(true);
    expect(shouldSkipImessageStatusCueForEmailApproval({
      messageText: "Hold up, don't send",
      recentContext,
    })).toBe(false);
    expect(shouldSkipImessageStatusCueForEmailApproval({
      messageText: "Yes, what is the E&O limit?",
      recentContext: "Glass: The policy is active.",
    })).toBe(false);
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
