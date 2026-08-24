import { describe, expect, it } from "vitest";
import {
  imessageMarkdownSource,
  imessagePlainText,
} from "../src/outboundText";

describe("iMessage outbound text", () => {
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

  it("removes Glass confidence markers before either outbound format", () => {
    const source =
      "[[g]:**Confirmed coverage** with [evidence](https://glass.insure)]]";

    expect(imessagePlainText(source)).toBe(
      "Confirmed coverage with evidence (https://glass.insure)",
    );
    expect(imessageMarkdownSource(source)).toBe(
      "**Confirmed coverage** with [evidence](https://glass.insure)",
    );
  });

  it("removes private tool activity trailers before either outbound format", () => {
    const source =
      "That's the full book.\n\n[tool activity: tools: lookup_policy]";

    expect(imessageMarkdownSource(source)).toBe("That's the full book.");
    expect(imessagePlainText(source)).toBe("That's the full book.");
  });

  it("preserves nested double brackets inside confidence spans", () => {
    const source = "[[g:Use `[[1, 2]]` in the formula]]";

    expect(imessageMarkdownSource(source)).toBe(
      "Use `[[1, 2]]` in the formula",
    );
    expect(imessagePlainText(source)).toBe(
      "Use [[1, 2]] in the formula",
    );
  });

  it("does not close a confidence span inside code or a nested link label", () => {
    const source =
      "[[g:Use `tail]]` and see [array [1, 2]](https://glass.insure)]]";

    expect(imessageMarkdownSource(source)).toBe(
      "Use `tail]]` and see [array [1, 2]](https://glass.insure)",
    );
    expect(imessagePlainText(source)).toBe(
      "Use tail]] and see array [1, 2] (https://glass.insure)",
    );
  });
});
