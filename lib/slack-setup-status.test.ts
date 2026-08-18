import { describe, expect, test } from "vitest";
import { resolveSlackRowStatus } from "./slack-setup-status";

describe("Slack setup row status", () => {
  test.each([
    {
      input: {
        connected: false,
        needsUpdate: false,
        setupStatus: null,
        enabled: true,
        healthStatus: "revoked" as const,
      },
      expected: { label: "Reinstall required", tone: "danger" },
    },
    {
      input: {
        connected: true,
        needsUpdate: false,
        setupStatus: null,
        enabled: true,
        healthStatus: "channel_unavailable" as const,
      },
      expected: { label: "Channel unavailable", tone: "danger" },
    },
    {
      input: {
        connected: false,
        needsUpdate: false,
        setupStatus: null,
        enabled: false,
      },
      expected: { label: "Not connected", tone: "neutral" },
    },
    {
      input: {
        connected: false,
        needsUpdate: false,
        setupStatus: "in_progress" as const,
        enabled: false,
      },
      expected: { label: "Setup in progress", tone: "warning" },
    },
    {
      input: {
        connected: true,
        needsUpdate: true,
        setupStatus: "in_progress" as const,
        enabled: true,
      },
      expected: { label: "Update required", tone: "danger" },
    },
    {
      input: {
        connected: true,
        needsUpdate: false,
        setupStatus: "completed" as const,
        enabled: true,
      },
      expected: { label: "On", tone: "success" },
    },
    {
      input: {
        connected: true,
        needsUpdate: false,
        setupStatus: null,
        enabled: false,
      },
      expected: { label: "Off", tone: "neutral" },
    },
  ])(
    "returns $expected.label with the required precedence",
    ({ input, expected }) => {
      expect(resolveSlackRowStatus(input)).toEqual(expected);
    },
  );
});
