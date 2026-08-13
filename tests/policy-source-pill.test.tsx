import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PolicySourcePill } from "@/components/context-reference-card";

vi.mock("@/hooks/use-entity-preview", () => ({
  useEntityPreview: () => ({ openPreview: vi.fn() }),
}));

vi.mock("@/lib/sync/glass-cached-queries", () => ({
  useCachedPolicySummary: () => ({
    carrier: "Northwoods Continental Insurance Company",
    policyNumber: "NWC-100",
  }),
}));

describe("PolicySourcePill", () => {
  it("keeps compact policy sources free of the ASCII brand pattern", () => {
    const markup = renderToStaticMarkup(
      <PolicySourcePill id="policy-id" />,
    );

    expect(markup).toContain("Northwoods Continental Insurance Company");
    expect(markup).toContain("NWC-100");
    expect(markup).toContain(">N</span>");
    expect(markup).not.toContain("data:image/svg+xml");
    expect(markup).not.toContain("mask-image");
  });
});
