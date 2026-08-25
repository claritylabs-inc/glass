import { describe, expect, test } from "vitest";
import { automationTextPreview } from "./actions/connectedEmailScan";

describe("automationTextPreview", () => {
  test("uses the bounded HTML converter instead of exposing markup", () => {
    const preview = automationTextPreview(
      `<style>.secret { display: none }</style><p>Hello <strong>Terry</strong>.</p><script>ignoreMe()</script><p>Review the renewal.</p>`,
      "text/html; charset=utf-8",
    );

    expect(preview).toBe("Hello Terry. Review the renewal.");
    expect(preview).not.toContain("ignoreMe");
    expect(preview).not.toContain("<p>");
  });

  test("caps the final preview", () => {
    expect(automationTextPreview("a".repeat(20_000), "text/plain")).toHaveLength(
      12_000,
    );
  });
});
