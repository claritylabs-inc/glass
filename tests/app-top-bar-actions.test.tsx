// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PillButton } from "@/components/ui/pill-button";

const ROOT = join(__dirname, "..");
let mountedRoot: Root | null = null;

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
});

describe("app top-bar actions", () => {
  it("keeps expanding icon actions accessible before their label is visible", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <PillButton variant="icon" label="Copy thread" expandLabel>
          <svg aria-hidden="true" />
        </PillButton>,
      );
    });

    const button = container.querySelector("button");
    const label = button?.querySelector("[data-pill-expand-label]");

    expect(button?.getAttribute("aria-label")).toBe("Copy thread");
    expect(button?.getAttribute("data-icon-only")).toBe("true");
    expect(button?.getAttribute("data-expand-label")).toBe("true");
    expect(button?.hasAttribute("title")).toBe(false);
    expect(button?.className).toContain("text-label");
    expect(button?.className).toContain("duration-[280ms]");
    expect(button?.className).not.toContain("max-w-");
    expect(label?.textContent).toBe("Copy thread");
    expect(label?.parentElement?.className).toContain(
      "grid-cols-[auto_minmax(0,0fr)]",
    );
    expect(label?.parentElement?.className).toContain(
      "group-hover/pill:grid-cols-[auto_minmax(0,1fr)]",
    );
    expect(label?.className).toContain("group-focus-visible/pill");
    expect(label?.className).toContain("pointer:fine");
    expect(label?.className).toContain("motion-reduce:transition-none");
  });

  it("uses one shared row for presence and portal actions", () => {
    const topBar = read("components/app-top-bar.tsx");

    expect(topBar).toContain('data-slot="app-top-bar-actions"');
    expect(topBar).toContain('className="flex shrink-0 items-center gap-2"');
    expect(topBar).toContain("{showBrokerShare ? <BrokerShareLinkButton /> : null}");
    expect(topBar).toContain("{actions}");
  });

  it.each([
    ["app/policies/page.tsx", "Upload policy", "<Upload"],
    ["app/clients/page.tsx", "Invite client", "<UserPlus"],
    ["components/settings/team-section.tsx", "Invite member", "<UserPlus"],
    ["components/settings/email-connections-section.tsx", "Add mailbox", "<Plus"],
    ["components/settings/connected-orgs-section.tsx", "Add vendor", "<Link2"],
    ["app/operator/clients/operator-clients-page.tsx", "Create client", "<Plus"],
    ["app/operator/brokers/page.tsx", "Create broker", "<Plus"],
  ])("keeps %s as an icon-and-label primary action", (path, label, icon) => {
    const source = read(path);
    const labelIndex = source.indexOf(label);
    const buttonStart = source.lastIndexOf("<PillButton", labelIndex);
    const button = source.slice(buttonStart, labelIndex + label.length);

    expect(buttonStart).toBeGreaterThan(-1);
    expect(button).toContain(icon);
    expect(button).not.toContain('variant="secondary"');
    expect(button).not.toContain('variant="icon"');
  });

  it.each([
    ["components/broker-share-link-button.tsx", "Copy signup link", "<Link2"],
    ["app/profile/page.tsx", "Change email", "<Mail"],
    [
      "app/operator/routing/page.tsx",
      'label={loading ? "Refreshing…" : "Refresh"}',
      "<RefreshCw",
    ],
    [
      "app/operator/clients/[clientOrgId]/operator-client-impersonation-action.tsx",
      "Impersonate",
      "<UserRoundCog",
    ],
  ])("keeps %s as an expanding secondary action", (path, label, icon) => {
    const source = read(path);
    const labelIndex = source.indexOf(label);
    const buttonStart = source.lastIndexOf("<PillButton", labelIndex);
    const buttonEnd = source.indexOf("</PillButton>", labelIndex);
    const button = source.slice(buttonStart, buttonEnd);

    expect(buttonStart).toBeGreaterThan(-1);
    expect(button).toContain('variant="icon"');
    expect(button).toContain("expandLabel");
    expect(button).toContain(icon);
  });
});
