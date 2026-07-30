export type LiteParseQueuePriority = "http" | "preview" | "full";

export type LiteParseQueueFairnessState = {
  httpStartsWhilePreviewWaiting: number;
  nonFullStartsWhileFullWaiting: number;
};

export const INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE: LiteParseQueueFairnessState = {
  httpStartsWhilePreviewWaiting: 0,
  nonFullStartsWhileFullWaiting: 0,
};

const MAX_HIGHER_PRIORITY_BURST = 4;

export function selectNextLiteParseQueueIndex(
  priorities: LiteParseQueuePriority[],
  state: LiteParseQueueFairnessState,
): {
  index: number;
  state: LiteParseQueueFairnessState;
} {
  if (priorities.length === 0) {
    return {
      index: -1,
      state: INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE,
    };
  }

  const previewIndex = priorities.indexOf("preview");
  const fullIndex = priorities.indexOf("full");
  let index = 0;

  if (
    fullIndex >= 0 &&
    state.nonFullStartsWhileFullWaiting >= MAX_HIGHER_PRIORITY_BURST
  ) {
    index = fullIndex;
  } else if (
    previewIndex >= 0 &&
    priorities[0] === "http" &&
    state.httpStartsWhilePreviewWaiting >= MAX_HIGHER_PRIORITY_BURST
  ) {
    index = previewIndex;
  }

  const selected = priorities[index];
  return {
    index,
    state: {
      httpStartsWhilePreviewWaiting:
        previewIndex < 0 || selected !== "http"
          ? 0
          : state.httpStartsWhilePreviewWaiting + 1,
      nonFullStartsWhileFullWaiting:
        fullIndex < 0 || selected === "full"
          ? 0
          : state.nonFullStartsWhileFullWaiting + 1,
    },
  };
}
