// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openOAuthTab } from "@/lib/oauth-tab";

describe("openOAuthTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a new tab synchronously and removes its opener", () => {
    const replace = vi.fn();
    const popup = {
      opener: window,
      closed: false,
      location: { replace },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    const oauthTab = openOAuthTab();

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(oauthTab?.navigate("https://slack.com/oauth/v2/authorize")).toBe(
      true,
    );
    expect(replace).toHaveBeenCalledWith(
      "https://slack.com/oauth/v2/authorize",
    );
  });

});
