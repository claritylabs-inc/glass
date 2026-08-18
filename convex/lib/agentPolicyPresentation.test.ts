import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  createAgentPolicyPresentationState,
  MAX_POLICY_CARDS_PER_TURN,
} from "./agentPolicyPresentation";

function policyId(value: string) {
  return value as Id<"policies">;
}

describe("createAgentPolicyPresentationState", () => {
  test("requires a successful current-turn policy reference", () => {
    const state = createAgentPolicyPresentationState();

    expect(
      state.selectPolicyCard({
        policyId: "policy-a",
        allowMultiple: false,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toMatchObject({ ok: false, status: "not_referenced" });
  });

  test("records tool provenance and selects one exact policy by default", () => {
    const state = createAgentPolicyPresentationState();
    state.recordToolPolicyReference({
      policyId: policyId("policy-a"),
      toolCallId: "call-1",
      toolName: "lookup_policy",
    });
    state.recordToolPolicyReference({
      policyId: policyId("policy-a"),
      toolCallId: "call-1",
      toolName: "lookup_policy",
    });

    expect(state.toolPolicyReferences).toEqual([
      {
        policyId: "policy-a",
        toolCallId: "call-1",
        toolName: "lookup_policy",
      },
    ]);
    expect(
      state.selectPolicyCard({
        policyId: "policy-a",
        allowMultiple: false,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toEqual({ ok: true, policyId: "policy-a" });
    expect(state.presentedPolicyIds).toEqual(["policy-a"]);
  });

  test("allows more than one exact card only for an explicit multi-card request", () => {
    const state = createAgentPolicyPresentationState();
    for (const id of ["policy-a", "policy-b"]) {
      state.recordToolPolicyReference({
        policyId: policyId(id),
        toolCallId: "call-1",
        toolName: "lookup_policy",
      });
    }

    expect(
      state.selectPolicyCard({
        policyId: "policy-a",
        allowMultiple: false,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toMatchObject({ ok: true });
    expect(
      state.selectPolicyCard({
        policyId: "policy-b",
        allowMultiple: false,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toMatchObject({ ok: false, status: "multiple_not_requested" });
    expect(
      state.selectPolicyCard({
        policyId: "policy-b",
        allowMultiple: true,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toMatchObject({ ok: true });
  });

  test("suppresses recent cards unless the user explicitly asks again", () => {
    const state = createAgentPolicyPresentationState();
    state.recordToolPolicyReference({
      policyId: policyId("policy-a"),
      toolCallId: "call-1",
      toolName: "lookup_policy",
    });

    expect(
      state.selectPolicyCard({
        policyId: "policy-a",
        allowMultiple: false,
        repeatRequested: false,
        wasRecentlyPresented: true,
      }),
    ).toMatchObject({ ok: false, status: "recently_presented" });
    expect(
      state.selectPolicyCard({
        policyId: "policy-a",
        allowMultiple: false,
        repeatRequested: true,
        wasRecentlyPresented: true,
      }),
    ).toMatchObject({ ok: true });
  });

  test("enforces the hard per-turn card limit", () => {
    const state = createAgentPolicyPresentationState();
    for (let index = 0; index <= MAX_POLICY_CARDS_PER_TURN; index += 1) {
      state.recordToolPolicyReference({
        policyId: policyId(`policy-${index}`),
        toolCallId: "call-1",
        toolName: "lookup_policy",
      });
    }
    for (let index = 0; index < MAX_POLICY_CARDS_PER_TURN; index += 1) {
      expect(
        state.selectPolicyCard({
          policyId: `policy-${index}`,
          allowMultiple: true,
          repeatRequested: false,
          wasRecentlyPresented: false,
        }),
      ).toMatchObject({ ok: true });
    }

    expect(
      state.selectPolicyCard({
        policyId: `policy-${MAX_POLICY_CARDS_PER_TURN}`,
        allowMultiple: true,
        repeatRequested: false,
        wasRecentlyPresented: false,
      }),
    ).toMatchObject({ ok: false, status: "limit_reached" });
  });
});
