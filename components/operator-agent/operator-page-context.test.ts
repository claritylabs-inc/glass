import { describe, expect, test } from "vitest";

import {
  operatorPageContextFromPathname,
  operatorPageContextsShareScope,
} from "./operator-page-context";

describe("operator page context", () => {
  test("resolves a nested operator client policy before policy data loads", () => {
    expect(
      operatorPageContextFromPathname(
        "/operator/clients/client-123/policies/policy-456",
      ),
    ).toEqual({
      pageType: "policy",
      entityId: "policy-456",
      summary: "Current policy",
    });
  });

  test.each([
    {
      name: "the same policy",
      left: { pageType: "policy", entityId: "policy-1" },
      right: { pageType: "policy", entityId: "policy-1" },
      expected: true,
    },
    {
      name: "subpages for the same client",
      left: { pageType: "operator_client", entityId: "client-1" },
      right: { pageType: "operator_client_files", entityId: "client-1" },
      expected: true,
    },
    {
      name: "different entities",
      left: { pageType: "policy", entityId: "policy-1" },
      right: { pageType: "policy", entityId: "policy-2" },
      expected: false,
    },
    {
      name: "the same entity-free portal area",
      left: { pageType: "operator_routing" },
      right: { pageType: "operator_routing" },
      expected: true,
    },
    {
      name: "different entity-free portal areas",
      left: { pageType: "operator_routing" },
      right: { pageType: "operator_telemetry" },
      expected: false,
    },
  ])("matches $name", ({ left, right, expected }) => {
    expect(operatorPageContextsShareScope(left, right)).toBe(expected);
  });
});
