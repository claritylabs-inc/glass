import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusTag } from "@/components/ui/status-tag";

describe("StatusTag", () => {
  it("renders the shared status geometry with a semantic tone", () => {
    const markup = renderToStaticMarkup(
      <StatusTag tone="success">Connected</StatusTag>,
    );

    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain("bg-emerald-500/10");
    expect(markup).toContain(">Connected</span>");
  });

  it("uses the quiet neutral treatment by default", () => {
    const markup = renderToStaticMarkup(<StatusTag>Pending</StatusTag>);

    expect(markup).toContain('data-tone="neutral"');
    expect(markup).toContain("bg-foreground/[0.04]");
  });
});
