import { describe, expect, it } from "vitest";
import {
  renderAgentMarkdownHtml,
  renderAgentMarkdownText,
  renderSlackMrkdwn,
} from "./transportRenderers";

describe("transport renderers", () => {
  it("sanitizes raw HTML and unsafe links for email", () => {
    const html = renderAgentMarkdownHtml(
      '<script>alert(1)</script>\n\n**Safe** [bad](javascript:alert(1)) [good](https://example.test/a_(b))',
    );

    expect(html).not.toContain("script");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("<strong>Safe</strong>");
    expect(html).toContain('href="https://example.test/a_(b)"');
    expect(renderAgentMarkdownText("**Safe**")).toBe("Safe");
  });

  it("preserves colon literals, indentation, arithmetic, and balanced links in Slack", () => {
    const rendered = renderSlackMrkdwn(
      "- `A:B` is 1 < 2\n  - :literal_status:\n\n[Open](https://example.test/a_(b))",
    );

    expect(rendered).toContain("`A:B` is 1 &lt; 2");
    expect(rendered).toContain(":literal_status:");
    expect(rendered).toContain("https://example.test/a_(b)");
  });

  it("escapes Slack control syntax while keeping parsed formatting", () => {
    const source = "<@U123> <!channel> <#C123|private> **done**";

    expect(renderSlackMrkdwn(source)).toBe(
      "&lt;@U123&gt; &lt;!channel&gt; &lt;#C123|private&gt; *done*",
    );
  });

  it("converts Markdown inside list items instead of leaking the source", () => {
    const source = [
      "**Sigillo Supply, Inc.** is currently in **onboarding**.",
      "",
      "- **Industry:** Wholesale distribution",
      "- **Website:** [sigillosupply](https://sigillosupply.test)",
      "- nested:",
      "  - **deep** item",
      "",
      "Platform status: **0 policies**.",
    ].join("\n");

    expect(renderSlackMrkdwn(source)).toBe(
      [
        "*Sigillo Supply, Inc.* is currently in *onboarding*.",
        "",
        "• *Industry:* Wholesale distribution",
        "• *Website:* <https://sigillosupply.test|sigillosupply>",
        "• nested:",
        "  • *deep* item",
        "",
        "Platform status: *0 policies*.",
      ].join("\n"),
    );
  });

  it("renders headings, tables, and task lists Slack can display", () => {
    const source = [
      "# Renewals",
      "",
      "| Client | Status |",
      "| --- | --- |",
      "| Acme | **active** |",
      "",
      "- [x] Sent the quote",
      "- [ ] Booked the **call**",
    ].join("\n");

    expect(renderSlackMrkdwn(source)).toBe(
      [
        "*Renewals*",
        "",
        "*Client* | *Status*",
        "Acme | *active*",
        "",
        "• [x] Sent the quote",
        "• [ ] Booked the *call*",
      ].join("\n"),
    );
  });

  it("keeps ordered lists and following prose on separate lines", () => {
    expect(renderSlackMrkdwn("1. First **step**\n2. Second\n\nThen we file.")).toBe(
      "1. First *step*\n2. Second\n\nThen we file.",
    );
  });

  it("strips nested confidence annotations without losing Markdown", () => {
    const source = "[[g:**Confirmed [[i:likely]] result**]]";

    expect(renderSlackMrkdwn(source)).toBe("*Confirmed likely result*");
  });
});
