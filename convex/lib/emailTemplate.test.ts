import { describe, expect, test } from "vitest";

import {
  buildEmailShell,
  buildOtpEmail,
  buildSlackInstallInviteEmail,
} from "./emailTemplate";

describe("shared email shell", () => {
  test("supports dark mode in standards-based and Outlook clients", () => {
    const html = buildEmailShell({
      title: "Dark mode test",
      bodyHtml:
        '<tr><td><p class="glass-email-text-primary">Visible</p></td></tr>',
    });

    expect(html).toContain(
      '<meta name="color-scheme" content="light dark">',
    );
    expect(html).toContain(
      '<meta name="supported-color-schemes" content="light dark">',
    );
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("[data-ogsc] .glass-email-text-primary");
    expect(html).toContain("[data-ogsb] .glass-email-page");
    expect(html).toContain('class="glass-email-container glass-email-body"');
    expect(html).not.toContain('content="light">');
  });

  test("marks OTP content with semantic dark-mode classes", () => {
    const email = buildOtpEmail("123456");

    expect(email.html).toContain(
      'class="glass-email-text-primary glass-email-surface"',
    );
    expect(email.html).toContain('class="glass-email-divider"');
    expect(email.html).toContain('class="glass-email-text-muted"');
  });
});

describe("Slack install invitation email", () => {
  test("uses the shared Glass shell and Slack's official install button", () => {
    const email = buildSlackInstallInviteEmail({
      clientName: "Cove & Co.",
      installUrl:
        "https://slack.com/oauth/v2/authorize?client_id=client&state=secret",
      siteUrl: "https://app.example.test",
    });

    expect(email.subject).toBe("Install the Glass Slack app for Cove & Co.");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain("Glass</span>");
    expect(email.html).toContain("Install the Glass app once in your workspace");
    expect(email.html).toContain("Cove &amp; Co.");
    expect(email.html).toContain(
      "Clarity Labs sets up your shared support channel separately",
    );
    expect(email.html).toContain(
      "add Glass to as many other channels as your team needs",
    );
    expect(email.html).toContain(
      "https://platform.slack-edge.com/img/add_to_slack.png",
    );
    expect(email.html).toContain('class="glass-email-text-primary"');
    expect(email.html).toContain('class="glass-email-surface"');
    expect(email.html).toContain('class="glass-email-link"');
    expect(email.html).toContain('alt="Add to Slack"');
    expect(email.html).toContain(
      "https://slack.com/oauth/v2/authorize?client_id=client&amp;state=secret",
    );
    expect(email.html).toContain("This one-time invitation expires in 7 days");
    expect(email.text).toContain("Choose the Cove & Co. Slack workspace");
    expect(email.text).toContain(
      "Add @Glass to any channels where you want it to respond",
    );
    expect(email.text).not.toContain("#glass-cove");
    expect(email.text).toContain("private 1:1 message");
    expect(email.text).toContain(
      "Direct messages stay between that Slack member and Glass",
    );
  });
});
