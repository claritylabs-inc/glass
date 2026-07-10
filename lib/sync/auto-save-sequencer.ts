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
  if (latest === null || latest.resetKey !== current.resetKey) return false;
  if (latest.generation !== current.generation) return !latest.settled;
  return latest.valueKey !== current.valueKey;
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
