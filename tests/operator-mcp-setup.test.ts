import { describe, expect, it } from "vitest";

import {
  operatorMcpClientConfig,
  operatorMcpClientSetups,
  operatorMcpEndpoint,
} from "../lib/operator-mcp-setup";

const endpoint = "https://actions.spot.insure/mcp";

describe("operator MCP endpoint", () => {
  it("normalizes any deployment URL to the site origin", () => {
    expect(operatorMcpEndpoint("https://actions.spot.insure")).toBe(endpoint);
    expect(operatorMcpEndpoint("https://actions.spot.insure/mcp")).toBe(
      endpoint,
    );
    expect(operatorMcpEndpoint("http://127.0.0.1:3211/")).toBe(
      "http://127.0.0.1:3211/mcp",
    );
  });
});

describe("operator MCP client setups", () => {
  it("gives Claude Code an HTTP server at the requested scope", () => {
    const [claudeCode] = operatorMcpClientSetups({ endpoint });

    expect(claudeCode.command).toEqual([
      "claude",
      "mcp",
      "add",
      "--transport",
      "http",
      "--scope",
      "user",
      "spot",
      endpoint,
    ]);
    expect(
      operatorMcpClientSetups({ endpoint, claudeScope: "project" })[0].command,
    ).toContain("project");
  });

  it("pins the Codex audience and asks for write scope", () => {
    const codex = operatorMcpClientSetups({ endpoint })[1];

    // Operator tokens are audience-bound, and write tools are hidden without
    // the write scope, so both must be explicit for Codex.
    expect(codex.command).toEqual([
      "codex",
      "mcp",
      "add",
      "spot",
      "--url",
      endpoint,
      "--oauth-resource",
      endpoint,
    ]);
    expect(codex.authCommand).toEqual([
      "codex",
      "mcp",
      "login",
      "spot",
      "--scopes",
      "read,write",
    ]);
    expect(codex.snippet).toContain("codex mcp login");
  });

  it("offers a generic streamable HTTP configuration", () => {
    expect(JSON.parse(operatorMcpClientConfig(endpoint))).toEqual({
      mcpServers: { spot: { type: "http", url: endpoint } },
    });
  });
});
