// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pathnameState } = vi.hoisted(() => ({
  pathnameState: { value: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
}));

import {
  AppTopBar,
  resolveAppBreadcrumb,
} from "@/components/app-top-bar";

const mounts: Array<{ container: HTMLDivElement; root: Root }> = [];

async function renderTopBar(
  pathname: string,
  breadcrumbDetail?: string,
) {
  pathnameState.value = pathname;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounts.push({ container, root });

  await act(async () => {
    root.render(
      createElement(AppTopBar, {
        breadcrumbDetail,
        showBrokerShare: false,
      }),
    );
  });

  return { container, root };
}

afterEach(async () => {
  for (const { container, root } of mounts.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("app breadcrumbs", () => {
  it.each([
    ["/operator", "Clients", "/operator"],
    ["/operator/clients", "Clients", "/operator"],
    ["/operator/clients/client-123", "Clients", "/operator"],
    ["/operator/brokers", "Brokers", "/operator/brokers"],
    ["/operator/demo-leads", "Demo leads", "/operator/demo-leads"],
    ["/operator/channels", "Channels", "/operator/channels"],
    ["/operator/routing", "Routing", "/operator/routing"],
    ["/operator/profile", "Profile", "/operator/profile"],
  ])("resolves operator route %s", (pathname, label, href) => {
    expect(resolveAppBreadcrumb(pathname)).toEqual({ label, href });
  });

  it.each([
    ["/clients", "Clients", "/clients"],
    ["/clients/client-123", "Clients", "/clients"],
    ["/clients/client-123/policies", "Clients", "/clients"],
    ["/clients/client-123/settings/", "Clients", "/clients"],
    ["/policies/policy-123", "Policies", "/policies"],
    ["/connect/clients", "Clients", "/connect/clients"],
    ["/connect/vendors/vendor-123/policies", "Vendors", "/connect/vendors"],
    ["/deliveries", "Deliveries", "/deliveries"],
  ])("resolves client and broker route %s", (pathname, label, href) => {
    expect(resolveAppBreadcrumb(pathname)).toEqual({ label, href });
  });

  it("renders the operator client hierarchy without duplicating the list label", async () => {
    const detail = await renderTopBar(
      "/operator/clients/client-123",
      "Release",
    );

    expect(detail.container.textContent).toContain("Clients/Release");
    expect(detail.container.querySelector("a")?.getAttribute("href")).toBe(
      "/operator",
    );

    await act(async () => detail.root.unmount());
    detail.container.remove();
    mounts.splice(
      mounts.findIndex(({ container }) => container === detail.container),
      1,
    );

    const list = await renderTopBar("/operator/clients");
    expect(list.container.textContent?.match(/Clients/g)).toHaveLength(1);
  });
});
