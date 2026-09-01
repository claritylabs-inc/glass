import { describe, expect, test } from "vitest";
import {
  filterToolsForWriteAccess,
  MAILBOX_COORDINATOR_WRITE_TOOL_NAMES,
  MCP_CHAT_WRITE_TOOL_NAMES,
} from "./mcpAgentToolAccess";

function namedTools(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, { name }]));
}

describe("MCP nested agent tool access", () => {
  test("removes every MCP-chat business write for read-only tokens", () => {
    const tools = namedTools([
      "lookup_policy",
      "coordinate_mailbox_task",
      ...MCP_CHAT_WRITE_TOOL_NAMES,
    ]);
    const filtered = filterToolsForWriteAccess(
      tools,
      false,
      MCP_CHAT_WRITE_TOOL_NAMES,
    );

    expect(Object.keys(filtered).sort()).toEqual([
      "coordinate_mailbox_task",
      "lookup_policy",
    ]);
  });

  test("limits a read-only mailbox coordinator to mailbox reads", () => {
    const readTools = [
      "search_connected_email",
      "read_connected_email",
      "read_connected_email_attachment",
    ];
    const tools = namedTools([
      ...readTools,
      ...MAILBOX_COORDINATOR_WRITE_TOOL_NAMES,
    ]);

    expect(
      Object.keys(
        filterToolsForWriteAccess(
          tools,
          false,
          MAILBOX_COORDINATOR_WRITE_TOOL_NAMES,
        ),
      ).sort(),
    ).toEqual(readTools.sort());
  });

  test("retains write tools when write scope is available", () => {
    const tools = namedTools([...MCP_CHAT_WRITE_TOOL_NAMES]);
    expect(
      filterToolsForWriteAccess(tools, true, MCP_CHAT_WRITE_TOOL_NAMES),
    ).toBe(tools);
  });
});
