import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE,
  selectNextLiteParseQueueIndex,
  type LiteParseQueueFairnessState,
  type LiteParseQueuePriority,
} from "../src/liteparseQueue.js";

function drain(
  priorities: LiteParseQueuePriority[],
): LiteParseQueuePriority[] {
  const queue = [...priorities];
  const selected: LiteParseQueuePriority[] = [];
  let state: LiteParseQueueFairnessState = {
    ...INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE,
  };

  while (queue.length > 0) {
    const selection = selectNextLiteParseQueueIndex(queue, state);
    state = selection.state;
    selected.push(queue.splice(selection.index, 1)[0]);
  }

  return selected;
}

test("gives a waiting full parse a turn after four higher-priority starts", () => {
  assert.deepEqual(
    drain([
      "http",
      "http",
      "http",
      "http",
      "http",
      "http",
      "preview",
      "preview",
      "full",
    ]).slice(0, 5),
    ["http", "http", "http", "http", "full"],
  );
});

test("gives a waiting preview a turn after four HTTP starts", () => {
  assert.deepEqual(
    drain([
      "http",
      "http",
      "http",
      "http",
      "http",
      "http",
      "preview",
    ]),
    ["http", "http", "http", "http", "preview", "http", "http"],
  );
});

test("does not carry a stale burst penalty into a newly waiting class", () => {
  const initial = selectNextLiteParseQueueIndex(
    ["http"],
    {
      httpStartsWhilePreviewWaiting: 4,
      nonFullStartsWhileFullWaiting: 4,
    },
  );

  assert.deepEqual(initial.state, INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE);
  assert.equal(
    selectNextLiteParseQueueIndex(
      ["http", "full"],
      initial.state,
    ).index,
    0,
  );
});
