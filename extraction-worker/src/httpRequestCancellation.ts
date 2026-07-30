import type { IncomingMessage, ServerResponse } from "node:http";

export function watchClientDisconnect(
  req: IncomingMessage,
  res: ServerResponse,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort();
    }
  };

  req.once("aborted", abort);
  res.once("close", abort);
  req.socket.once("close", abort);

  return {
    signal: controller.signal,
    dispose: () => {
      req.off("aborted", abort);
      res.off("close", abort);
      req.socket.off("close", abort);
    },
  };
}
