import { describe, expect, it } from "vitest";
import {
  rankTaskControlCandidates,
  taskControlResponse,
} from "../convex/lib/taskControlIntent";

describe("task control intent", () => {
  it("ranks short natural-language task exits without regex branching", () => {
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
      const ranking = rankTaskControlCandidates(text);
      expect(ranking.topCandidate?.intent, text).toBe("cancel_task");
      expect(ranking.highConfidence, text).toBe(true);
      expect(ranking.shouldUseModel, text).toBe(false);
    }
  });

  it("recognizes reset commands separately from cancellation", () => {
    expect(rankTaskControlCandidates("start over").topCandidate?.intent).toBe("reset_task");
    expect(rankTaskControlCandidates("reset this task").topCandidate?.intent).toBe("reset_task");
    expect(taskControlResponse("reset_task")).toContain("What would you like to do next?");
  });

  it("keeps typo-tolerant candidate retrieval available for model fallback", () => {
    const ranking = rankTaskControlCandidates("leav it");

    expect(ranking.topCandidate?.intent).toBe("cancel_task");
    expect(ranking.topCandidate?.fuzzyMatches).toEqual([
      expect.objectContaining({ queryToken: "leav", exampleToken: "leave" }),
    ]);
  });

  it("does not swallow insurance cancellation or document requests", () => {
    for (const text of [
      "cancel this policy",
      "can you attach the cancellation email itself?",
      "what does the cancellation condition say?",
      "send the notice of cancellation",
      "remove this location from the policy",
    ]) {
      const ranking = rankTaskControlCandidates(text);
      expect(ranking.highConfidence, text).toBe(false);
      expect(ranking.shouldUseModel, text).toBe(false);
    }
  });

  it("uses model arbitration for plausible ambiguous task-control candidates", () => {
    const ranking = rankTaskControlCandidates("maybe drop the coi thing");

    expect(ranking.topCandidate?.intent).toBe("cancel_task");
    expect(ranking.highConfidence).toBe(false);
    expect(ranking.shouldUseModel).toBe(true);
  });

  it("does not treat one-word fragments as deterministic exits", () => {
    for (const text of ["drop", "leave"]) {
      const ranking = rankTaskControlCandidates(text);
      expect(ranking.topCandidate?.intent, text).toBe("cancel_task");
      expect(ranking.highConfidence, text).toBe(false);
      expect(ranking.shouldUseModel, text).toBe(true);
    }
  });

  it("does not swallow continuation commands with task-control phrases", () => {
    for (const text of [
      "no thanks send the certificate",
      "no thanks generate it",
      "start over and issue it",
    ]) {
      const ranking = rankTaskControlCandidates(text);
      expect(ranking.highConfidence, text).toBe(false);
      expect(ranking.shouldUseModel, text).toBe(false);
    }
  });

});
