import { describe, expect, it } from "vitest";

import {
  createAutoSaveSequencer,
  hasRebasedAutoSaveIntent,
  isCurrentAutoSaveRequest,
  isDivergentAutoSaveRequest,
  waitForStableAutoSaveBarriers,
} from "../lib/sync/auto-save-sequencer";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("auto-save sequencer", () => {
  it("does not reuse the first A request after an intervening B request", () => {
    const firstA = {
      generation: 0,
      requestId: 1,
      resetKey: "profile",
      valueKey: "A",
    };
    const pendingB = {
      generation: 0,
      requestId: 2,
      resetKey: "profile",
      valueKey: "B",
      settled: false,
    };
    const currentA = { generation: 0, resetKey: "profile", valueKey: "A" };
    const finalA = {
      generation: 0,
      requestId: 3,
      resetKey: "profile",
      valueKey: "A",
      settled: false,
    };

    expect(isCurrentAutoSaveRequest(firstA, pendingB, currentA)).toBe(false);
    expect(isDivergentAutoSaveRequest(pendingB, currentA)).toBe(true);
    expect(isCurrentAutoSaveRequest(finalA, finalA, currentA)).toBe(true);
  });

  it("rejects stale value and reset completions", () => {
    const request = {
      generation: 0,
      requestId: 1,
      resetKey: "profile-1",
      valueKey: "A",
    };
    const latest = { ...request, settled: false };

    expect(
      isCurrentAutoSaveRequest(request, latest, {
        generation: 0,
        resetKey: "profile-1",
        valueKey: "B",
      }),
    ).toBe(false);
    expect(
      isCurrentAutoSaveRequest(request, latest, {
        generation: 1,
        resetKey: "profile-2",
        valueKey: "A",
      }),
    ).toBe(false);
    expect(
      isCurrentAutoSaveRequest(request, latest, {
        generation: 1,
        resetKey: "profile-1",
        valueKey: "A",
      }),
    ).toBe(false);
  });

  it("does not infer current intent from requests in older generations", () => {
    const oldPending = {
      generation: 1,
      requestId: 4,
      resetKey: "profile-1",
      valueKey: "A",
      settled: false,
    };
    const current = {
      generation: 3,
      resetKey: "profile-1",
      valueKey: "A",
    };

    expect(isDivergentAutoSaveRequest(oldPending, current)).toBe(false);
    expect(
      isDivergentAutoSaveRequest(
        { ...oldPending, valueKey: "B" },
        current,
      ),
    ).toBe(false);
    expect(
      isDivergentAutoSaveRequest({ ...oldPending, settled: true }, current),
    ).toBe(false);
    expect(
      isDivergentAutoSaveRequest(
        { ...oldPending, settled: true, valueKey: "B" },
        current,
      ),
    ).toBe(false);
  });

  it("restores an explicit rebased intent after an older value request", () => {
    const oldPending = {
      generation: 1,
      requestId: 4,
      resetKey: "entity-1",
      valueKey: "B",
      settled: false,
    };
    const current = {
      generation: 3,
      resetKey: "entity-1",
      valueKey: "A",
    };

    expect(hasRebasedAutoSaveIntent(oldPending, current, false)).toBe(false);
    expect(hasRebasedAutoSaveIntent(oldPending, current, true)).toBe(true);
    expect(
      hasRebasedAutoSaveIntent(
        { ...oldPending, valueKey: "A" },
        current,
        true,
      ),
    ).toBe(false);
  });

  it("rejects a multi-save barrier when intent changes while another save waits", async () => {
    const slow = deferred();
    let revision = 0;
    const barrier = waitForStableAutoSaveBarriers(
      [async () => true, async () => slow.promise.then(() => true)],
      () => revision,
    );

    revision += 1;
    slow.resolve();

    await expect(barrier).resolves.toBe(false);
  });

  it("persists A -> B -> A in intent order even when earlier writes are slow", async () => {
    const sequencer = createAutoSaveSequencer();
    const gates = [deferred(), deferred(), deferred()];
    const started: string[] = [];
    let persisted = "initial";

    const save = (value: string, index: number) =>
      sequencer.run(async () => {
        started.push(value);
        await gates[index].promise;
        persisted = value;
        return value;
      });

    const firstA = save("A", 0);
    const b = save("B", 1);
    const finalA = save("A", 2);

    await Promise.resolve();
    expect(started).toEqual(["A"]);

    gates[0].resolve();
    await firstA;
    await Promise.resolve();
    expect(started).toEqual(["A", "B"]);

    gates[1].resolve();
    await b;
    await Promise.resolve();
    expect(started).toEqual(["A", "B", "A"]);

    gates[2].resolve();
    await expect(finalA).resolves.toBe("A");
    expect(persisted).toBe("A");
  });

  it("continues with the latest write after an earlier write fails", async () => {
    const sequencer = createAutoSaveSequencer();
    const writes: string[] = [];

    const failed = sequencer.run(async () => {
      writes.push("failed");
      throw new Error("temporary");
    });
    const recovered = sequencer.run(async () => {
      writes.push("latest");
      return true;
    });

    await expect(failed).rejects.toThrow("temporary");
    await expect(recovered).resolves.toBe(true);
    expect(writes).toEqual(["failed", "latest"]);
  });
});
