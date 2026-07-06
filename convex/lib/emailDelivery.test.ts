import { describe, expect, test } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { buildPendingEmailResendPayload } from "./emailDelivery";

describe("buildPendingEmailResendPayload", () => {
  test("uses pending email fields instead of stale serialized payload values", () => {
    const pending = {
      emailPayload: JSON.stringify({
        from: "Old Agent <old@glass.insure>",
        to: "wrong@claritylabs.inc",
        cc: ["old-cc@claritylabs.inc"],
        subject: "Old subject",
        text: "Old text",
        html: "<p>Old text</p>",
        reply_to: "thread@glass.insure",
        headers: {
          "In-Reply-To": "<old-parent@example.com>",
          References: "<old-parent@example.com>",
        },
      }),
      fromHeader: "Glass Agent <agent@glass.insure>",
      replyTo: "thread@glass.insure",
      inReplyTo: "<parent@example.com>",
      references: "<root@example.com> <parent@example.com>",
      renderedText: "Rendered current text",
      renderedHtml: "<p>Rendered current text</p>",
      recipientEmail: "terry@claritylabs.inc",
      ccAddresses: ["cc@claritylabs.inc"],
      bccAddresses: ["bcc@claritylabs.inc"],
      subject: "Current subject",
      emailBody: "Current body",
    } as Doc<"pendingEmails">;

    const payload = buildPendingEmailResendPayload(pending, {
      outboundMessageId: "<glass-pending-1@glass.insure>",
      threadEmail: "thread@glass.insure",
    });

    expect(payload.from).toBe("Glass Agent <agent@glass.insure>");
    expect(payload.to).toBe("terry@claritylabs.inc");
    expect(payload.cc).toEqual(["cc@claritylabs.inc"]);
    expect(payload.bcc).toEqual(["bcc@claritylabs.inc"]);
    expect(payload.subject).toBe("Current subject");
    expect(payload.text).toBe("Rendered current text");
    expect(payload.html).toBe("<p>Rendered current text</p>");
    expect(payload.reply_to).toBeUndefined();
    expect(payload.headers).toMatchObject({
      "Message-ID": "<glass-pending-1@glass.insure>",
      "In-Reply-To": "<parent@example.com>",
      References: "<root@example.com> <parent@example.com>",
    });
  });
});
