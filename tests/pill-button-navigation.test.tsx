// @vitest-environment happy-dom

import { forwardRef, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: forwardRef<
    HTMLAnchorElement,
    AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  >(function MockNextLink({ prefetch, ...props }, ref) {
    return (
      <a
        ref={ref}
        data-client-link="true"
        data-prefetch={String(prefetch)}
        {...props}
      />
    );
  }),
}));

import { PillButton } from "@/components/ui/pill-button";

describe("PillButton navigation", () => {
  it("client-routes and fully prefetches internal app hrefs", () => {
    const markup = renderToStaticMarkup(
      <PillButton href="/operator/clients/client-1">Open client</PillButton>,
    );

    expect(markup).toContain('data-client-link="true"');
    expect(markup).toContain('data-prefetch="true"');
  });

  it.each([
    ["external URLs", "https://example.com/file", undefined],
    ["protocol links", "mailto:person@example.com", undefined],
    ["downloads", "/files/report.pdf", "report.pdf"],
  ])("keeps %s on native anchors", (_case, href, download) => {
    const markup = renderToStaticMarkup(
      <PillButton href={href} download={download}>
        Open
      </PillButton>,
    );

    expect(markup).not.toContain("data-client-link");
    expect(markup).toContain(`href="${href}"`);
  });
});
