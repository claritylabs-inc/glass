// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMPERSONATION_ACK_TIMEOUT_MS,
  useStartOperatorImpersonation,
} from "@/hooks/use-start-operator-impersonation";

const mocks = vi.hoisted(() => ({
  isWebSocketConnected: true,
  mutation: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({
    isWebSocketConnected: mocks.isWebSocketConnected,
  }),
  useMutation: () => mocks.mutation,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { operator: { startImpersonation: "operator.startImpersonation" } },
}));

let mountedRoot: Root | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function Harness() {
  const { startImpersonation, status } = useStartOperatorImpersonation();
  return (
    <button
      data-status={status}
      onClick={() => {
        void startImpersonation({
          targetOrgId: "client-1" as never,
          targetRole: "admin",
          destination: "/policies",
          failureMessage: "Failed to impersonate client",
        });
      }}
    >
      Start
    </button>
  );
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

async function renderHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot?.render(<Harness />);
  });
  return container.querySelector("button") as HTMLButtonElement;
}

afterEach(async () => {
  vi.useRealTimers();
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  mocks.isWebSocketConnected = true;
  vi.clearAllMocks();
});

describe("resilient operator impersonation start", () => {
  it("does not enqueue a mutation while disconnected", async () => {
    mocks.isWebSocketConnected = false;
    const button = await renderHarness();

    await act(async () => button.click());

    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(button.dataset.status).toBe("retry");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "You're offline. Reconnect before impersonating.",
    );
  });

  it("ends the spinner and safely handles a late commit", async () => {
    vi.useFakeTimers();
    const request = deferred<{ sessionId: string; reused: boolean }>();
    mocks.mutation.mockReturnValue(request.promise);
    const button = await renderHarness();

    await act(async () => button.click());
    expect(button.dataset.status).toBe("starting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IMPERSONATION_ACK_TIMEOUT_MS);
    });
    expect(button.dataset.status).toBe("retry");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Connection interrupted. Impersonation is still pending; retry is safe.",
    );

    await act(async () => {
      request.resolve({ sessionId: "session-1", reused: false });
      await request.promise;
    });
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith("/policies");
    expect(button.dataset.status).toBe("idle");
  });

  it("routes immediately after an acknowledged mutation", async () => {
    mocks.mutation.mockResolvedValue({ sessionId: "session-1", reused: false });
    const button = await renderHarness();

    await act(async () => button.click());

    expect(mocks.push).toHaveBeenCalledWith("/policies");
    expect(button.dataset.status).toBe("idle");
  });

  it("surfaces a rejected mutation as a retryable state", async () => {
    mocks.mutation.mockRejectedValue(new Error("Operator session expired"));
    const button = await renderHarness();

    await act(async () => button.click());

    expect(mocks.push).not.toHaveBeenCalled();
    expect(button.dataset.status).toBe("retry");
    expect(mocks.toastError).toHaveBeenCalledWith("Operator session expired");
  });

  it("ignores a stale acknowledgement after the target changes", async () => {
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
