#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GlassClient } from "./client.js";
import { registerPolicyTools } from "./tools/policies.js";
import { registerThreadTools } from "./tools/threads.js";
import { registerOrgTools } from "./tools/org.js";
import { registerAgentTools } from "./tools/agent.js";
import { registerBrokerTools } from "./tools/broker.js";
import { registerClientTools } from "./tools/client.js";

// Validate env vars — support both Glass and legacy Glass env var names
const GLASS_CONVEX_SITE_URL = process.env.GLASS_CONVEX_SITE_URL ?? process.env.PRISM_CONVEX_SITE_URL;
const GLASS_API_KEY = process.env.GLASS_API_KEY ?? process.env.PRISM_API_KEY;

if (!GLASS_CONVEX_SITE_URL) {
  console.error("Error: GLASS_CONVEX_SITE_URL environment variable is required");
  process.exit(1);
}

if (!GLASS_API_KEY) {
  console.error("Error: GLASS_API_KEY environment variable is required");
  process.exit(1);
}

// Create client
const client = new GlassClient(GLASS_CONVEX_SITE_URL, GLASS_API_KEY);

// Create MCP server
const server = new McpServer({
  name: "glass",
  version: "2.0.0",
});

// Register all tools
registerPolicyTools(server, client);
registerThreadTools(server, client);
registerOrgTools(server, client);
registerAgentTools(server, client);
registerBrokerTools(server, client);
registerClientTools(server, client);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
