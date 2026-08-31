import { describe, expect, it } from "vitest";
import { imessagePlainText } from "../src/outboundText";

describe("iMessage outbound text", () => {
  it("keeps common GFM structures readable without raw formatting markers", () => {
    const source = [
      "# Coverage",
      "",
      "- **Limit:** $5,000",
      "- ~~Old deductible~~ New deductible",
      "- [Open Spot](https://spot.insure)",
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
        "• Open Spot (https://spot.insure)",
        "",
        "Field | Value",
        "Code | G20",
      ].join("\n"),
    );
  });
});
