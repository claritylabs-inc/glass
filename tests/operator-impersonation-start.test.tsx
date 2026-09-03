// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStartOperatorImpersonation } from "@/hooks/use-start-operator-impersonation";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  push: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
  useMutation: () => mocks.mutation,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/convex/_generated/api", () => ({
  api: { operator: { startImpersonation: "operator.startImpersonation" } },
}));

let mountedRoot: Root | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function SwitchTargetHarness() {
  const { startImpersonation } = useStartOperatorImpersonation();
  return (
    <>
      <button
        onClick={() => {
          void startImpersonation({
            targetOrgId: "client-1" as never,
            targetRole: "admin",
            destination: "/policies/first",
            failureMessage: "Failed to impersonate client",
          });
        }}
      >
        First
      </button>
      <button
        onClick={() => {
          void startImpersonation({
            targetOrgId: "client-2" as never,
            targetRole: "admin",
            destination: "/policies/second",
            failureMessage: "Failed to impersonate client",
          });
        }}
      >
        Second
      </button>
    </>
  );
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("operator impersonation start", () => {
  it("ignores an acknowledgement after the target changes", async () => {
    const firstRequest = deferred<{ sessionId: string; reused: boolean }>();
    const secondRequest = deferred<{ sessionId: string; reused: boolean }>();
    mocks.mutation
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);
    await act(async () => {
      mountedRoot?.render(<SwitchTargetHarness />);
    });
    const [firstButton, secondButton] = Array.from(
      container.querySelectorAll("button"),
    );

    await act(async () => firstButton.click());
    await act(async () => secondButton.click());
    await act(async () => {
      firstRequest.resolve({ sessionId: "session-1", reused: false });
      await firstRequest.promise;
    });
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      secondRequest.resolve({ sessionId: "session-2", reused: false });
      await secondRequest.promise;
    });
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith("/policies/second");
  });
});
