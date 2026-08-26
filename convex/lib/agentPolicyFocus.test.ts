import { describe, expect, test } from "vitest";
import {
  MAX_POLICY_FOCUS_IDS,
  selectPolicyFocusIds,
} from "./agentPolicyFocus";

describe("agent policy focus", () => {
  test("current explicit policy targets win and remain bounded", () => {
    const explicit = Array.from({ length: 8 }, (_, index) => `explicit-${index}`);
    expect(selectPolicyFocusIds([
      { role: "agent", referencedPolicyIds: ["old-policy"] },
    ], explicit)).toEqual(explicit.slice(0, MAX_POLICY_FOCUS_IDS));
  });

  test("carries IDs only from the immediately previous completed agent response", () => {
    expect(selectPolicyFocusIds([
      { role: "user" },
      { role: "agent", referencedPolicyIds: ["policy-1", "policy-1", "policy-2"] },
    ])).toEqual(["policy-1", "policy-2"]);

    expect(selectPolicyFocusIds([
      { role: "agent", referencedPolicyIds: ["policy-1"] },
      { role: "user" },
    ])).toEqual([]);
    expect(selectPolicyFocusIds([
      { role: "agent", status: "error", referencedPolicyIds: ["policy-1"] },
    ])).toEqual([]);
  });
});
