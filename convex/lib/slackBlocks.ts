import type { Doc, Id } from "../_generated/dataModel";
import { getClientPortalUrl } from "./domains";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import { resolvePolicyCarrierDisplay } from "./policyPartyContext";
import { renderSlackMrkdwn } from "./transportRenderers";

export type SlackBlock = Record<string, unknown>;
export type SlackEmailDraftCard = {
  recipientEmail: string;
  subject: string;
  attachmentCount: number;
  reviewUrl: string;
};
type SlackAgentStep = NonNullable<Doc<"threadMessages">["agentSteps"]>[number];
type SlackToolStep = Extract<SlackAgentStep, { type: "tool" }>;

export const SLACK_DEFAULT_PROCESSING_REACTION = "eyes";
export const SLACK_PROCESSING_REACTIONS = [
  SLACK_DEFAULT_PROCESSING_REACTION,
  "mag",
  "thinking_face",
  "page_facing_up",
  "memo",
  "shield",
  "umbrella",
  "email",
  "speech_balloon",
  "wrench",
  "bar_chart",
  "sparkles",
] as const;
export const SLACK_REACTION_TOOL_NAME = "choose_slack_reaction";

const TOOL_LABELS: Record<string, string> = {
  lookup_address: "Validated the address",
  lookup_policy: "Found the policy record",
  lookup_company_context: "Reviewed company context",
  lookup_policy_section: "Reviewed policy sources",
  present_policy_card: "Shared the policy record",
  attach_policy_document: "Attached the policy PDF",
  compare_coverages: "Compared coverages",
  lookup_compliance_requirements: "Checked insurance requirements",
  lookup_connected_vendors: "Checked connected vendors",
  lookup_vendor_policies: "Reviewed vendor policies",
  lookup_vendor_compliance: "Checked vendor compliance",
  send_email: "Prepared the email",
  email_expert: "Prepared the email",
  save_note: "Saved the note",
  confirm_policy_fact: "Confirmed policy facts",
  generate_coi: "Generated the certificate",
  request_human_service: "Requested human service",
  coordinate_mailbox_task: "Coordinated the mailbox task",
  web_research: "Researched the web",
  render_email_preview: "Rendered the email preview",
};

function blockId(...parts: Array<string | number>): string {
  return parts
    .join("-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 255);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSlackAnswerText(value: string): string {
  return renderSlackMrkdwn(value);
}

function displayDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function policyTitle(policy: Doc<"policies">): string {
  if (policy.policyNumber?.trim()) return `Policy ${policy.policyNumber.trim()}`;
  const names = policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .slice(0, 2)
    .map(lobLabel);
  return names.join(" · ") || policy.fileName || "Policy details";
}

function policyBody(policy: Doc<"policies">): string {
  const carrier = resolvePolicyCarrierDisplay(policy).carrierDisplayName;
  const lines = policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .slice(0, 2)
    .map(lobLabel)
    .join(", ");
  const term = [displayDate(policy.effectiveDate), displayDate(policy.expirationDate)]
    .filter(Boolean)
    .join(" – ");
  return truncate(
    [policy.insuredName, carrier, lines, term].filter(Boolean).join(" · "),
    200,
  );
}

export function slackPolicyUrl(policyId: Id<"policies">): string {
  return `${getClientPortalUrl()}/policies/${policyId}`;
}

function slackCertificateUrl(
  policyId: Id<"policies"> | undefined,
): string {
  return policyId
    ? `${slackPolicyUrl(policyId)}?tab=certificates`
    : `${getClientPortalUrl()}/certificates`;
}

function certificateAttachments(
  message: Pick<Doc<"threadMessages">, "attachments">,
) {
  return (message.attachments ?? []).filter(
    (attachment) => attachment.kind === "coi",
  );
}

function feedbackBlock(args: {
  messageId: Id<"threadMessages">;
  revision: number;
  actionToken: string;
}): SlackBlock {
  return {
    type: "context_actions",
    block_id: blockId("glass-feedback", args.messageId, args.revision),
    elements: [
      {
        type: "feedback_buttons",
        action_id: "glass_response_feedback",
        positive_button: {
          text: { type: "plain_text", text: "Helpful" },
          value: `positive:${args.actionToken}`,
          accessibility_label: "Mark this Glass response as helpful",
        },
        negative_button: {
          text: { type: "plain_text", text: "Needs work" },
          value: `negative:${args.actionToken}`,
          accessibility_label: "Mark this Glass response as needing work",
        },
      },
    ],
  };
}

export function buildSlackFinalBlocks(args: {
  message: Pick<
    Doc<"threadMessages">,
    "_id" | "content" | "agentSteps" | "status" | "attachments"
  >;
  policies: Doc<"policies">[];
  emailDraft?: SlackEmailDraftCard;
  actionToken: string;
  revision: number;
  showHandoff: boolean;
}): SlackBlock[] {
  const completedTools = (args.message.agentSteps ?? [])
    .filter(
      (step): step is SlackToolStep =>
        step.type === "tool" &&
        step.completed === true &&
        step.name !== SLACK_REACTION_TOOL_NAME,
    )
    .slice(-4);
  const blocks: SlackBlock[] = [
    {
      type: "section",
      block_id: blockId("glass-answer", args.message._id, args.revision),
      text: {
        type: "mrkdwn",
        text: truncate(
          formatSlackAnswerText(args.message.content.trim()) ||
            "I couldn't complete that request.",
          3000,
        ),
      },
    },
  ];

  if (completedTools.length) {
    blocks.push({
      type: "context",
      block_id: blockId("glass-trace", args.message._id, args.revision),
      elements: [
        {
          type: "mrkdwn",
          text: truncate(
            `*Work completed:* ${completedTools
              .map((step) => TOOL_LABELS[step.name] ?? "Completed a task")
              .join(" · ")}`,
            2000,
          ),
        },
      ],
    });
  }

  if (args.emailDraft) {
    const attachmentLabel =
      args.emailDraft.attachmentCount > 0
        ? ` · ${args.emailDraft.attachmentCount} attachment${args.emailDraft.attachmentCount === 1 ? "" : "s"}`
        : "";
    blocks.push({
      type: "card",
      block_id: blockId("glass-email-draft", args.message._id, args.revision),
      title: { type: "plain_text", text: "Email draft" },
      subtitle: {
        type: "plain_text",
        text: truncate(`To ${args.emailDraft.recipientEmail}`, 150),
      },
      body: {
        type: "plain_text",
        text: truncate(`${args.emailDraft.subject}${attachmentLabel}`, 200),
      },
      actions: [
        {
          type: "button",
          action_id: "glass_open_email_draft",
          value: args.actionToken,
          url: args.emailDraft.reviewUrl,
          text: { type: "plain_text", text: "Review draft" },
          accessibility_label: `Review email draft to ${args.emailDraft.recipientEmail}`,
        },
      ],
    });
  }

  for (const [index, policy] of args.policies.slice(0, 3).entries()) {
    blocks.push({
      type: "card",
      block_id: blockId("glass-policy", policy._id, args.revision, index),
      title: { type: "plain_text", text: truncate(policyTitle(policy), 150) },
      subtitle: {
        type: "plain_text",
        text: policy.extractionDataStage === "preview" ? "Preliminary policy details" : "Policy details",
      },
      body: { type: "plain_text", text: policyBody(policy) || "Open this policy in Glass." },
      actions: [
        {
          type: "button",
          action_id: "glass_open_policy",
          value: args.actionToken,
          url: slackPolicyUrl(policy._id),
          text: { type: "plain_text", text: "Open policy" },
          accessibility_label: `Open ${policyTitle(policy)} in Glass`,
        },
      ],
    });
  }

  for (const [index, attachment] of certificateAttachments(args.message)
    .slice(0, 2)
    .entries()) {
    blocks.push({
      type: "card",
      block_id: blockId("glass-certificate", args.message._id, args.revision, index),
      title: { type: "plain_text", text: "Certificate ready" },
      subtitle: { type: "plain_text", text: "Attached in this Slack conversation" },
      body: {
        type: "plain_text",
        text: truncate(attachment.filename, 200),
      },
      actions: [
        {
          type: "button",
          action_id: "glass_open_certificate",
          value: args.actionToken,
          url: slackCertificateUrl(args.policies[0]?._id),
          text: { type: "plain_text", text: "View certificates" },
          accessibility_label: "Open certificates in Glass",
        },
      ],
    });
  }

  const actionElements: SlackBlock[] = [];
  if (args.showHandoff) {
    actionElements.push({
      type: "button",
      action_id: "glass_request_human",
      value: args.actionToken,
      text: { type: "plain_text", text: "Ask a human" },
      accessibility_label: "Request help from a Glass service team member",
    });
  }
  if (actionElements.length) {
    blocks.push({
      type: "actions",
      block_id: blockId("glass-actions", args.message._id, args.revision),
      elements: actionElements,
    });
  }

  blocks.push(feedbackBlock({
    messageId: args.message._id,
    revision: args.revision,
    actionToken: args.actionToken,
  }));
  return blocks.slice(0, 50);
}

/**
 * Uses only long-established Block Kit primitives. Slack can reject a newly
 * introduced block type for an older workspace or surface, so callers retry
 * this renderer automatically before falling back to plaintext.
 */
export function buildSlackClassicFinalBlocks(args: {
  message: Pick<
    Doc<"threadMessages">,
    "_id" | "content" | "agentSteps" | "status" | "attachments"
  >;
  policies: Doc<"policies">[];
  emailDraft?: SlackEmailDraftCard;
  actionToken: string;
  revision: number;
  showHandoff: boolean;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      block_id: blockId(
        "glass-classic-answer",
        args.message._id,
        args.revision,
      ),
      text: {
        type: "mrkdwn",
        text: truncate(
          formatSlackAnswerText(args.message.content.trim()) ||
            "I couldn't complete that request.",
          3000,
        ),
      },
    },
  ];

  if (args.emailDraft) {
    const attachmentLabel =
      args.emailDraft.attachmentCount > 0
        ? `\n${args.emailDraft.attachmentCount} attachment${args.emailDraft.attachmentCount === 1 ? "" : "s"}`
        : "";
    blocks.push(
      {
        type: "section",
        block_id: blockId(
          "glass-classic-email-draft",
          args.message._id,
          args.revision,
        ),
        text: {
          type: "mrkdwn",
          text: `*Email draft*\nTo ${escapeMrkdwn(args.emailDraft.recipientEmail)}\n${escapeMrkdwn(args.emailDraft.subject)}${attachmentLabel}`,
        },
      },
      {
        type: "actions",
        block_id: blockId(
          "glass-classic-email-action",
          args.message._id,
          args.revision,
        ),
        elements: [
          {
            type: "button",
            action_id: "glass_open_email_draft",
            value: args.actionToken,
            url: args.emailDraft.reviewUrl,
            text: { type: "plain_text", text: "Review draft" },
            accessibility_label: `Review email draft to ${args.emailDraft.recipientEmail}`,
          },
        ],
      },
    );
  }

  for (const [index, policy] of args.policies.slice(0, 3).entries()) {
    blocks.push(
      {
        type: "section",
        block_id: blockId("glass-classic-policy", policy._id, args.revision, index),
        text: {
          type: "mrkdwn",
          text: `*${escapeMrkdwn(policyTitle(policy))}*\n${escapeMrkdwn(policyBody(policy) || "Open this policy in Glass.")}`,
        },
      },
      {
        type: "actions",
        block_id: blockId("glass-classic-policy-action", policy._id, args.revision, index),
        elements: [
          {
            type: "button",
            action_id: "glass_open_policy",
            value: args.actionToken,
            url: slackPolicyUrl(policy._id),
            text: { type: "plain_text", text: "Open policy" },
            accessibility_label: `Open ${policyTitle(policy)} in Glass`,
          },
        ],
      },
    );
  }

  for (const [index, attachment] of certificateAttachments(args.message)
    .slice(0, 2)
    .entries()) {
    blocks.push({
      type: "section",
      block_id: blockId("glass-classic-certificate", args.message._id, args.revision, index),
      text: {
        type: "mrkdwn",
        text: `*Certificate ready*\n${escapeMrkdwn(truncate(attachment.filename, 200))}\nAttached in this Slack conversation.`,
      },
      accessory: {
        type: "button",
        action_id: "glass_open_certificate",
        value: args.actionToken,
        url: slackCertificateUrl(args.policies[0]?._id),
        text: { type: "plain_text", text: "View certificates" },
        accessibility_label: "Open certificates in Glass",
      },
    });
  }

  const finalActions: SlackBlock[] = [
    {
      type: "button",
      action_id: "glass_response_feedback_positive",
      value: `positive:${args.actionToken}`,
      text: { type: "plain_text", text: "Helpful" },
      accessibility_label: "Mark this Glass response as helpful",
    },
    {
      type: "button",
      action_id: "glass_response_feedback_negative",
      value: `negative:${args.actionToken}`,
      text: { type: "plain_text", text: "Needs work" },
      accessibility_label: "Mark this Glass response as needing work",
    },
  ];
  if (args.showHandoff) {
    finalActions.push({
      type: "button",
      action_id: "glass_request_human",
      value: args.actionToken,
      text: { type: "plain_text", text: "Ask a human" },
      accessibility_label: "Request help from a Glass service team member",
    });
  }
  blocks.push({
    type: "actions",
    block_id: blockId("glass-classic-actions", args.message._id, args.revision),
    elements: finalActions,
  });
  return blocks.slice(0, 50);
}
