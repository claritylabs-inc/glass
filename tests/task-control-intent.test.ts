import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectTaskControlIntent,
  isTaskControlIntent,
  taskControlResponse,
} from "../convex/lib/taskControlIntent";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("task control intent", () => {
  it("recognizes short natural-language task exits", () => {
    for (const text of [
      "nevermind",
      "never mind",
      "scratch this",
      "scratch that",
      "leave it",
      "leave it for now",
      "cancel this task",
      "drop it",
      "not now",
    ]) {
      expect(isTaskControlIntent(text), text).toBe(true);
      expect(detectTaskControlIntent(text), text).toBe("cancel_task");
    }
  });

  it("recognizes reset commands separately from cancellation", () => {
    expect(detectTaskControlIntent("start over")).toBe("reset_task");
    expect(detectTaskControlIntent("reset this task")).toBe("reset_task");
    expect(taskControlResponse("reset_task")).toContain("What would you like to do next?");
  });

  it("does not swallow insurance cancellation or document requests", () => {
    for (const text of [
      "cancel this policy",
      "can you attach the cancellation email itself?",
      "what does the cancellation condition say?",
      "send the notice of cancellation",
      "remove this location from the policy",
    ]) {
      expect(isTaskControlIntent(text), text).toBe(false);
    }
  });

  it("runs before stale COI context can trigger COI guard rewrites", () => {
    const imessage = read("convex/actions/handleInboundImessage.ts");
    const webChat = read("convex/actions/processThreadChat.ts");

    expect(imessage.indexOf("const taskControlIntent")).toBeGreaterThan(-1);
    expect(imessage.indexOf("const taskControlIntent")).toBeLessThan(
      imessage.indexOf("hasCoiRequestIntent(args.messageText"),
    );
    expect(webChat.indexOf("const taskControlIntent")).toBeGreaterThan(-1);
    expect(webChat.indexOf("const taskControlIntent")).toBeLessThan(
      webChat.indexOf("hasCoiEmailIntent(latestUserContent"),
    );
  });
});
