import { describe, expect, it } from "vitest";
import {
  imessageMarkdown,
  imessagePlainText,
} from "../src/outboundText";

describe("iMessage outbound text", () => {
  it("uses Spectrum markdown content for native iMessage formatting", async () => {
    await expect(imessageMarkdown("**Bold** and _italic_.").build()).resolves.toEqual({
      type: "markdown",
      markdown: "**Bold** and _italic_.",
    });
  });

  it("removes markdown syntax from low-level Photon sends", () => {
    const source =
      "You've got a **Starr Indemnity & Liability Company** policy " +
      "(#G20SILIM1001CUS) with **Personal Property Storage Insurance** — " +
      "$5,000 limit, $100 deductible.";

    expect(imessagePlainText(source)).toBe(
      "You've got a Starr Indemnity & Liability Company policy " +
        "(#G20SILIM1001CUS) with Personal Property Storage Insurance — " +
        "$5,000 limit, $100 deductible.",
    );
  });

  it("keeps common GFM structures readable without raw formatting markers", () => {
    const source = [
      "# Coverage",
      "",
      "- **Limit:** $5,000",
      "- ~~Old deductible~~ New deductible",
      "- [Open Glass](https://glass.insure)",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Code | `G20` |",
    ].join("\n");

    expect(imessagePlainText(source)).toBe(
      [
        "Coverage",
        "",
        "• Limit: $5,000",
        "• Old deductible New deductible",
        "• Open Glass (https://glass.insure)",
        "",
        "Field | Value",
        "Code | G20",
      ].join("\n"),
    );
  });

  it("removes Glass confidence markers before either outbound format", async () => {
    const source =
      "[[g]:**Confirmed coverage** with [evidence](https://glass.insure)]]";

    expect(imessagePlainText(source)).toBe(
      "Confirmed coverage with evidence (https://glass.insure)",
    );
    await expect(imessageMarkdown(source).build()).resolves.toEqual({
      type: "markdown",
      markdown:
        "**Confirmed coverage** with [evidence](https://glass.insure)",
    });
  });
});
