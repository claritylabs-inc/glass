import { describe, expect, it } from "vitest";
import {
  latestCompletedRouterRequest,
  normalizeExtractionTraceRouterFields,
} from "./extractionTraceRouterFields";

describe("normalizeExtractionTraceRouterFields", () => {
  it("promotes the safe cl-router response metadata and removes its nested duplicate", () => {
    const result = normalizeExtractionTraceRouterFields({
      details: {
        inputSummary: { promptBytes: 120 },
        clRouter: {
          requestId: "router-request-1",
          costUsd: 0.0012,
          costStatus: "priced",
          cachedInputTokens: 42,
          routing: {
            decision: "autonomous_primary",
            candidatesConsidered: [{ provider: "openai", model: "gpt-5.5" }],
            policyVersion: "policy-4",
            cacheStickinessApplied: true,
            routeSource: "autonomous",
            attemptCount: 1,
            shadowMode: true,
            wouldHaveChosen: {
              provider: "fireworks",
              model: "accounts/fireworks/models/glm-5p2",
              decision: "autonomous_primary",
            },
            wouldHaveMatched: false,
          },
        },
      },
    });

    expect(result).toEqual({
      routerRequestId: "router-request-1",
      cachedInputTokens: 42,
      costUsd: 0.0012,
      costStatus: "priced",
      routingDecision: "autonomous_primary",
      routing: {
        decision: "autonomous_primary",
        candidatesConsidered: [{ provider: "openai", model: "gpt-5.5" }],
        policyVersion: "policy-4",
        cacheStickinessApplied: true,
        routeSource: "autonomous",
        attemptCount: 1,
        shadowMode: true,
        wouldHaveChosen: {
          provider: "fireworks",
          model: "accounts/fireworks/models/glm-5p2",
          decision: "autonomous_primary",
        },
        wouldHaveMatched: false,
      },
      details: { inputSummary: { promptBytes: 120 } },
    });
  });

  it("keeps an unpriced null cost and rejects malformed nested routing", () => {
    const result = normalizeExtractionTraceRouterFields({
      details: {
        clRouter: {
          requestId: "router-request-2",
          costUsd: null,
          costStatus: "unpriced",
          cachedInputTokens: -1,
          routing: { decision: "missing-required-fields" },
          providerKeys: { openai: "must-not-survive" },
        },
      },
    });

    expect(result).toEqual({
      routerRequestId: "router-request-2",
      costUsd: null,
      costStatus: "unpriced",
      details: {},
    });
  });

  it("prefers validated first-class fields over compatibility metadata", () => {
    const result = normalizeExtractionTraceRouterFields({
      routerRequestId: "direct-request",
      cachedInputTokens: 8,
      routingDecision: "request_pin",
      details: {
        clRouter: {
          requestId: "nested-request",
          cachedInputTokens: 3,
          routing: {
            decision: "autonomous_primary",
            candidatesConsidered: [],
            policyVersion: null,
            cacheStickinessApplied: false,
          },
        },
      },
    });

    expect(result.routerRequestId).toBe("direct-request");
    expect(result.cachedInputTokens).toBe(8);
    expect(result.routingDecision).toBe("request_pin");
    expect(result.routing?.decision).toBe("autonomous_primary");
  });
});

describe("latestCompletedRouterRequest", () => {
  it("selects only the latest completed task call before review starts", () => {
    const origin = latestCompletedRouterRequest([
      {
        kind: "model_call",
        taskKind: "extraction_operational_profile",
        status: "complete",
        routerRequestId: "older-origin",
        timestamp: 10,
      },
      {
        kind: "model_call",
        taskKind: "extraction_operational_profile",
        status: "complete",
        routerRequestId: "latest-origin",
        timestamp: 20,
      },
      {
        kind: "model_call",
        taskKind: "extraction_review",
        status: "complete",
        routerRequestId: "reviewer-request",
        timestamp: 21,
      },
      {
        kind: "model_call",
        taskKind: "extraction_operational_profile",
        status: "complete",
        routerRequestId: "after-cutoff",
        timestamp: 30,
      },
    ], "extraction_operational_profile", 25);

    expect(origin).toEqual({ requestId: "latest-origin", timestamp: 20 });
  });
});
