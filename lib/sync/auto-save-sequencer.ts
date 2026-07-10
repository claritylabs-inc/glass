export type AutoSaveSequencer = {
  run<T>(task: () => Promise<T>): Promise<T>;
};

export type AutoSaveRequestIdentity = {
  generation: number;
  requestId: number;
  resetKey: string;
  valueKey: string;
};

export type AutoSaveRequestState = AutoSaveRequestIdentity & {
  settled: boolean;
};

export function isCurrentAutoSaveRequest(
  request: AutoSaveRequestIdentity,
  latest: AutoSaveRequestState | null,
  current: Pick<
    AutoSaveRequestIdentity,
    "generation" | "resetKey" | "valueKey"
  >,
) {
  return (
    latest?.requestId === request.requestId &&
    request.generation === current.generation &&
    request.resetKey === current.resetKey &&
    request.valueKey === current.valueKey
  );
}

export function isDivergentAutoSaveRequest(
  latest: AutoSaveRequestState | null,
  current: Pick<
    AutoSaveRequestIdentity,
    "generation" | "resetKey" | "valueKey"
  >,
) {
  return (
    latest !== null &&
    latest.resetKey === current.resetKey &&
    latest.generation === current.generation &&
    latest.valueKey !== current.valueKey
  );
}

export function hasRebasedAutoSaveIntent(
  latest: AutoSaveRequestState | null,
  current: Pick<
    AutoSaveRequestIdentity,
    "generation" | "resetKey" | "valueKey"
  >,
  intentChanged: boolean,
) {
  return (
    intentChanged &&
    latest !== null &&
    latest.resetKey === current.resetKey &&
    latest.generation !== current.generation &&
    latest.valueKey !== current.valueKey
  );
}

export async function waitForStableAutoSaveBarriers(
  barriers: Array<() => Promise<boolean>>,
  getRevision: () => number,
) {
  const revision = getRevision();
  const results = await Promise.all(barriers.map((barrier) => barrier()));
  return results.every(Boolean) && getRevision() === revision;
}

export function createAutoSaveSequencer(): AutoSaveSequencer {
  let tail = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>) {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
