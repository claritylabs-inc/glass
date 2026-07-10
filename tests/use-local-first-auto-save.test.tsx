// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createSyncStore,
  SyncProvider,
  type SyncStore,
} from "@claritylabs/cl-sync";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useLocalFirstAutoSave,
  type AutoSaveStatus,
} from "../lib/sync/use-local-first-auto-save";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type SaveArgs = { payload: string };
type SaveResult = {
  saveNow: (options?: { force?: boolean }) => Promise<boolean>;
  saving: boolean;
  status: AutoSaveStatus;
};
type HarnessProps = {
  applyLocal?: (
    store: SyncStore,
    args: SaveArgs,
    clientMutationId: string,
  ) => void;
  args: SaveArgs;
  autoSave?: boolean;
  canSave?: boolean;
  delayMs?: number;
  flush: (args: SaveArgs) => Promise<string>;
  onError?: (error: unknown, args: SaveArgs) => void;
  onFlushed?: (result: string | undefined, args: SaveArgs) => void;
  resetKey?: string;
  valueKey: string;
};

let mountedRoot: Root | null = null;

function Harness({
  applyLocal,
  args,
  autoSave = false,
  canSave = true,
  delayMs,
  flush,
  onError,
  onFlushed,
  resetKey = "entity",
  valueKey,
  onResult,
}: HarnessProps & { onResult: (result: SaveResult) => void }) {
  const result = useLocalFirstAutoSave({
    mutationName: "test.autoSave",
    applyLocal,
    args,
    valueKey,
    resetKey,
    autoSave,
    canSave,
    delayMs,
    flush,
    onError,
    onFlushed,
  });
  onResult(result);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(initialProps: HarnessProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const store = createSyncStore({
    scope: { appId: `auto-save-${Math.random()}` },
    persistence: "memory",
  });
  const root = createRoot(container);
  mountedRoot = root;
  let current!: SaveResult;

  async function render(props: HarnessProps) {
    await act(async () => {
      root.render(
        <SyncProvider store={store}>
          <Harness {...props} onResult={(result) => (current = result)} />
        </SyncProvider>,
      );
    });
  }

  return {
    get current() {
      return current;
    },
    render,
    store,
    startSave(options?: { force?: boolean }) {
      let save!: Promise<boolean>;
      act(() => {
        save = current.saveNow(options);
      });
      return save;
    },
    async start() {
      await render(initialProps);
    },
  };
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useLocalFirstAutoSave", () => {
  it("persists A -> B -> A in order and only acknowledges the final intent", async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: string[] = [];
    const acknowledged: string[] = [];
    const applyLocal = vi.fn();
    let persisted = "initial";
    let call = 0;
    const flush = async (args: SaveArgs) => {
      const gate = gates[call++];
      started.push(args.payload);
      const result = await gate.promise;
      persisted = args.payload;
      return result;
    };
    const onFlushed = (_result: string | undefined, args: SaveArgs) =>
      acknowledged.push(args.payload);
    const harness = createHarness({
      args: { payload: "initial" },
      applyLocal,
      flush,
      onFlushed,
      valueKey: "initial",
    });
    await harness.start();

    await harness.render({
      applyLocal,
      args: { payload: "A" },
      flush,
      onFlushed,
      valueKey: "A",
    });
    const firstA = harness.startSave();
    await act(async () => Promise.resolve());
    await harness.render({
      applyLocal,
      args: { payload: "B" },
      flush,
      onFlushed,
      valueKey: "B",
    });
    const b = harness.startSave();
    await harness.render({
      applyLocal,
      args: { payload: "A" },
      flush,
      onFlushed,
      valueKey: "A",
    });
    const finalA = harness.startSave();

    expect(started).toEqual(["A"]);
    expect(applyLocal).not.toHaveBeenCalled();
    expect(harness.current.status).toBe("saving");

    await act(async () => {
      gates[0].resolve("A");
      await firstA;
    });
    expect(await firstA).toBe(false);
    expect(started).toEqual(["A", "B"]);
    expect(acknowledged).toEqual([]);
    expect(applyLocal).not.toHaveBeenCalled();
    expect(harness.current.status).toBe("saving");

    await act(async () => {
      gates[1].resolve("B");
      await b;
    });
    expect(await b).toBe(false);
    expect(started).toEqual(["A", "B", "A"]);
    expect(acknowledged).toEqual([]);
    expect(applyLocal).not.toHaveBeenCalled();
    expect(harness.current.status).toBe("saving");

    await act(async () => {
      gates[2].resolve("A");
      await finalA;
    });
    expect(await finalA).toBe(true);
    expect(acknowledged).toEqual(["A"]);
    expect(applyLocal).toHaveBeenCalledOnce();
    expect(applyLocal).toHaveBeenCalledWith(
      harness.store,
      { payload: "A" },
      expect.any(String),
    );
    expect(persisted).toBe("A");
    expect(harness.current.status).toBe("saved");
    expect(harness.store.getOutbox()).toEqual([]);
  });

  it("does not adopt a stale success as the saved baseline", async () => {
    const stale = deferred<string>();
    const applyLocal = vi.fn();
    const onFlushed = vi.fn();
    const flush = vi
      .fn<(args: SaveArgs) => Promise<string>>()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce("current B");
    const harness = createHarness({
      applyLocal,
      args: { payload: "A" },
      flush,
      onFlushed,
      valueKey: "A",
    });
    await harness.start();
    await harness.render({
      applyLocal,
      args: { payload: "B" },
      flush,
      onFlushed,
      valueKey: "B",
    });
    const staleSave = harness.startSave();
    await act(async () => Promise.resolve());
    await harness.render({
      applyLocal,
      args: { payload: "C" },
      flush,
      onFlushed,
      valueKey: "C",
    });

    await act(async () => {
      stale.resolve("stale B");
      await staleSave;
    });
    expect(await staleSave).toBe(false);
    expect(applyLocal).not.toHaveBeenCalled();
    expect(onFlushed).not.toHaveBeenCalled();
    expect(harness.current.status).toBe("unsaved");

    await harness.render({
      applyLocal,
      args: { payload: "B" },
      flush,
      onFlushed,
      valueKey: "B",
    });
    const currentSave = harness.startSave();
    await act(async () => {
      await currentSave;
    });

    expect(await currentSave).toBe(true);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(onFlushed).toHaveBeenCalledOnce();
    expect(onFlushed).toHaveBeenCalledWith("current B", { payload: "B" });
    expect(applyLocal).toHaveBeenCalledOnce();
    expect(harness.current.status).toBe("saved");
  });

  it("suppresses stale reset effects and restores the current entity value", async () => {
    const success = deferred<string>();
    const staleRestore = deferred<string>();
    const failure = deferred<string>();
    const restored = deferred<string>();
    const onFlushed = vi.fn();
    const onError = vi.fn();
    const applyLocal = vi.fn();
    const persisted = new Map([
      ["entity-1", "A"],
      ["entity-2", "C"],
    ]);
    let call = 0;
    const gates = [success, staleRestore, failure, restored];
    const flush = async (args: SaveArgs) => {
      const gate = gates[call++];
      const result = await gate.promise;
      const [entity, payload] = args.payload.split(":");
      persisted.set(entity, payload);
      return result;
    };
    const harness = createHarness({
      args: { payload: "entity-1:A" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-1",
      valueKey: "A",
    });
    await harness.start();
    await harness.render({
      args: { payload: "entity-1:B" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-1",
      valueKey: "B",
    });
    const oldSuccess = harness.startSave();
    await act(async () => Promise.resolve());
    await harness.render({
      args: { payload: "entity-1:A" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-1",
      valueKey: "A",
    });
    const oldRestore = harness.startSave();
    await harness.render({
      args: { payload: "entity-2:C" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-2",
      valueKey: "C",
    });
    await harness.render({
      args: { payload: "entity-2:D" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-2",
      valueKey: "D",
    });
    const oldFailure = harness.startSave();
    await harness.render({
      args: { payload: "entity-1:A" },
      applyLocal,
      flush,
      onError,
      onFlushed,
      resetKey: "entity-1",
      valueKey: "A",
    });
    const restoredCurrent = harness.startSave();

    await act(async () => {
      success.resolve("B");
      await oldSuccess;
    });
    await act(async () => {
      staleRestore.reject(new Error("stale restore"));
      await oldRestore;
    });
    await act(async () => {
      failure.reject(new Error("stale"));
      await oldFailure;
    });
    await act(async () => {
      restored.resolve("A");
      await restoredCurrent;
    });

    expect(await oldSuccess).toBe(false);
    expect(await oldRestore).toBe(false);
    expect(await oldFailure).toBe(false);
    expect(await restoredCurrent).toBe(true);
    expect(onFlushed).toHaveBeenCalledOnce();
    expect(onFlushed).toHaveBeenCalledWith("A", { payload: "entity-1:A" });
    expect(onError).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(applyLocal).toHaveBeenCalledOnce();
    expect(applyLocal).toHaveBeenCalledWith(
      harness.store,
      { payload: "entity-1:A" },
      expect.any(String),
    );
    expect(persisted.get("entity-1")).toBe("A");
    expect(harness.current.status).toBe("saved");
  });

  it("keeps a policy-style full-draft key saved after pending args clear", async () => {
    const flush = vi.fn(async () => "saved");
    const harness = createHarness({
      args: { payload: "" },
      flush,
      valueKey: "draft-A",
    });
    await harness.start();
    await harness.render({ args: { payload: "field-B" }, flush, valueKey: "draft-B" });
    const save = harness.startSave();
    await act(async () => {
      await save;
    });
    await harness.render({ args: { payload: "" }, flush, valueKey: "draft-B" });

    expect(harness.current.status).toBe("saved");
  });

  it("reports a current failure and succeeds on explicit retry without an outbox replay", async () => {
    const onError = vi.fn();
    const flush = vi
      .fn<(args: SaveArgs) => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("saved");
    const harness = createHarness({
      args: { payload: "A" },
      flush,
      onError,
      valueKey: "A",
    });
    await harness.start();
    await harness.render({
      args: { payload: "B" },
      flush,
      onError,
      valueKey: "B",
    });

    const failed = harness.startSave();
    await act(async () => {
      await failed;
    });
    expect(await failed).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(harness.current.status).toBe("error");
    expect(harness.store.getOutbox()).toEqual([]);

    const retried = harness.startSave();
    await act(async () => {
      await retried;
    });
    expect(await retried).toBe(true);
    expect(harness.current.status).toBe("saved");
    expect(harness.store.getOutbox()).toEqual([]);
  });

  it("does not automatically retry a failed auto-save", async () => {
    vi.useFakeTimers();
    const flush = vi
      .fn<(args: SaveArgs) => Promise<string>>()
      .mockRejectedValue(new Error("offline"));
    const harness = createHarness({
      args: { payload: "A" },
      autoSave: true,
      delayMs: 0,
      flush,
      valueKey: "A",
    });
    await harness.start();
    await harness.render({
      args: { payload: "B" },
      autoSave: true,
      delayMs: 0,
      flush,
      valueKey: "B",
    });

    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(flush).toHaveBeenCalledOnce();
    expect(harness.current.status).toBe("error");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(flush).toHaveBeenCalledOnce();

    flush.mockResolvedValueOnce("saved");
    const retried = harness.startSave();
    await act(async () => {
      await retried;
    });
    expect(await retried).toBe(true);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(harness.current.status).toBe("saved");
  });

  it("reports a failed forced baseline save and waits for a forced retry", async () => {
    vi.useFakeTimers();
    const flush = vi
      .fn<(args: SaveArgs) => Promise<string>>()
      .mockRejectedValue(new Error("offline"));
    const harness = createHarness({
      args: { payload: "A" },
      autoSave: true,
      delayMs: 0,
      flush,
      valueKey: "A",
    });
    await harness.start();

    const failed = harness.startSave({ force: true });
    await act(async () => {
      await failed;
    });
    expect(await failed).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
    expect(harness.current.status).toBe("error");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(flush).toHaveBeenCalledOnce();

    flush.mockResolvedValueOnce("saved");
    const retried = harness.startSave({ force: true });
    await act(async () => {
      await retried;
    });
    expect(await retried).toBe(true);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(harness.current.status).toBe("saved");
  });

  it("waits for the configured auto-save delay before flushing", async () => {
    const flush = vi.fn(async (args: SaveArgs) => args.payload);
    const harness = createHarness({
      args: { payload: "A" },
      autoSave: true,
      delayMs: 50,
      flush,
      valueKey: "A",
    });
    await harness.start();
    vi.useFakeTimers();
    await harness.render({
      args: { payload: "B" },
      autoSave: true,
      delayMs: 50,
      flush,
      valueKey: "B",
    });

    await act(async () => vi.advanceTimersByTimeAsync(49));
    expect(flush).not.toHaveBeenCalled();
    expect(harness.current.status).toBe("saving");

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(flush).toHaveBeenCalledWith({ payload: "B" }, expect.any(String));
    expect(harness.current.status).toBe("saved");
  });
});
