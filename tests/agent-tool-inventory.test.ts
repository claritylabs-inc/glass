import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { tenantMcpToolNames } from "../convex/http";
import { OPERATOR_AGENT_TOOL_REGISTRY } from "../convex/lib/operatorAgentToolRegistry";

const inventory = readFileSync(join(process.cwd(), "AGENT_TOOLS.md"), "utf8");

function tableTools(section: string) {
  return Array.from(section.matchAll(/^\| `([^`]+)`/gm), (match) => match[1]);
}

describe("agent tool inventory", () => {
  test("matches the operator registry exactly", () => {
    const section = inventory
      .split("## Operator agent registry")[1]
      .split("### Operator MCP projection")[0];
    const registered = Object.keys(OPERATOR_AGENT_TOOL_REGISTRY).sort();

    expect(tableTools(section).sort()).toEqual(registered);
    expect(section).toContain(
      `The operator registry currently contains ${registered.length} tools.`,
    );
  });

  test("matches the tenant OAuth MCP catalog exactly", () => {
    const section = inventory
      .split("## Tenant OAuth MCP catalog")[1]
      .split("## Memory frontends and MCP boundaries")[0];
    const registered = tenantMcpToolNames().sort();

    expect(tableTools(section).sort()).toEqual(registered);
    expect(section).toContain(
      `It currently contains ${registered.length} tools.`,
    );
  });
});
