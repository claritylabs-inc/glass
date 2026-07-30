import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { watchClientDisconnect } from "../src/httpRequestCancellation.js";

function requestPair() {
  const socket = new EventEmitter();
  const req = new EventEmitter() as IncomingMessage;
  Object.assign(req, { socket });
  const res = new EventEmitter() as ServerResponse;
  Object.assign(res, { writableEnded: false });
  return { req, res, socket };
}

test("aborts when the response closes before conversion completes", () => {
  const { req, res } = requestPair();
  const cancellation = watchClientDisconnect(req, res);

  res.emit("close");

  assert.equal(cancellation.signal.aborted, true);
  cancellation.dispose();
});

test("does not abort after a response has completed normally", () => {
  const { req, res } = requestPair();
  const cancellation = watchClientDisconnect(req, res);
  Object.assign(res, { writableEnded: true });

  res.emit("close");

  assert.equal(cancellation.signal.aborted, false);
  cancellation.dispose();
});

test("aborts an interrupted upload before its body has been read", () => {
  const { req, res } = requestPair();
  const cancellation = watchClientDisconnect(req, res);

  req.emit("aborted");

  assert.equal(cancellation.signal.aborted, true);
  cancellation.dispose();
});

test("aborts when the client socket closes and removes every listener", () => {
  const { req, res, socket } = requestPair();
  const cancellation = watchClientDisconnect(req, res);

  socket.emit("close");
  cancellation.dispose();

  assert.equal(cancellation.signal.aborted, true);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
  assert.equal(socket.listenerCount("close"), 0);
});
