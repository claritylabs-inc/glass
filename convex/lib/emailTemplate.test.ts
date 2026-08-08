import { describe, expect, test } from "vitest";

import { buildSlackInstallInviteEmail } from "./emailTemplate";

describe("Slack install invitation email", () => {
  test("uses the shared Glass shell and Slack's official install button", () => {
    const email = buildSlackInstallInviteEmail({
      clientName: "Cove & Co.",
      channelName: "#glass-cove",
      installUrl:
        "https://slack.com/oauth/v2/authorize?client_id=client&state=secret",
      siteUrl: "https://app.example.test",
    });

    expect(email.subject).toBe("Install the Glass Slack app for Cove & Co.");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain("Glass</span>");
    expect(email.html).toContain("Glass is a Slack app");
    expect(email.html).toContain("Cove &amp; Co.");
    expect(email.html).toContain("#glass-cove");
    expect(email.html).toContain(
      "https://platform.slack-edge.com/img/add_to_slack.png",
    );
    expect(email.html).toContain('alt="Add to Slack"');
    expect(email.html).toContain(
      "https://slack.com/oauth/v2/authorize?client_id=client&amp;state=secret",
    );
    expect(email.html).toContain("This one-time invitation expires in 7 days");
    expect(email.text).toContain("Choose the Cove & Co. Slack workspace");
    expect(email.text).toContain("Add @Glass to #glass-cove");
  });
});
