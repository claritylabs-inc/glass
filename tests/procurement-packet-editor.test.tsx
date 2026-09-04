// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PacketEditor } from "../components/procurement/packet-workspace";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  save: vi.fn(),
  error: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useMutation: () => mocks.save,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("preserves unsaved packet edits across live updates and a rejected save", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  const section = {
    _id: "section",
    key: "summary",
    heading: "Summary",
    body: "Original",
    updatedAt: 1,
  };
  mocks.query.mockReturnValue({ packetRevision: 1, sections: [section] });
  mocks.save.mockRejectedValue(
    new Error("The packet changed while you were editing"),
  );
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(async () => {
      root.render(<PacketEditor requestId={requestId} onClose={onClose} />);
    });
  try {
    await render();
    const input = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "My unsaved draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.query.mockReturnValue({
      packetRevision: 2,
      sections: [{ ...section, body: "Another operator's edit", updatedAt: 2 }],
    });
    await render();
    expect(container.querySelector("textarea")?.value).toBe("My unsaved draft");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Save packet"))!
        .click();
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      requestId,
      expectedPacketRevision: 1,
      sections: [{ key: "summary", body: "My unsaved draft" }],
    });
    expect(container.querySelector("textarea")?.value).toBe("My unsaved draft");
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  }
});
