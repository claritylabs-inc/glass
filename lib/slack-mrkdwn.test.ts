import { describe, expect, test } from "vitest";
import { slackMrkdwnToMarkdown } from "./slack-mrkdwn";

describe("Slack mrkdwn browser rendering", () => {
  test("converts quoted Slack copy, links, lists, and emphasis to Markdown", () => {
    const source = [
      "here's the request from Gina:",
      "",
      "&gt; I'm looking at *<https://www.google.com/maps/search/1305+Carroll?entry=gmail&amp;source=g|1305 Carroll Avenue>*.",
      "&gt; A few details:",
      "&gt; • 7,500 SF industrial/warehouse",
      "&gt; Our lender, *Tri Counties Bank*, requires property insurance.",
      "&gt; I'd also appreciate *earthquake coverage*, if available.",
    ].join("\n");

    expect(slackMrkdwnToMarkdown(source)).toBe(
      [
        "here's the request from Gina:",
        "",
        "> I'm looking at **[1305 Carroll Avenue](<https://www.google.com/maps/search/1305+Carroll?entry=gmail&source=g>)**.",
        "> A few details:",
        "> - 7,500 SF industrial/warehouse",
        ">",
        "> Our lender, **Tri Counties Bank**, requires property insurance.",
        "> I'd also appreciate **earthquake coverage**, if available.",
      ].join("\n"),
    );
  });

  test("keeps code literal while making Slack references readable", () => {
    expect(
      slackMrkdwnToMarkdown(
        "`*literal* &gt;` and *bold* ~done~ <#C123|claims> <@U123|Terry> <!channel>",
      ),
    ).toBe("`*literal* >` and **bold** ~~done~~ #claims @Terry @channel");
  });
});
