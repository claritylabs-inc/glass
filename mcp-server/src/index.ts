#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismClient } from "./client.js";
import { registerPolicyTools } from "./tools/policies.js";
import { registerQuoteTools } from "./tools/quotes.js";
import { registerApplicationTools } from "./tools/applications.js";
import { registerThreadTools } from "./tools/threads.js";
import { registerContextTools } from "./tools/context.js";
import { registerOrgTools } from "./tools/org.js";
import { registerAgentTools } from "./tools/agent.js";

// Validate env vars
const PRISM_CONVEX_SITE_URL = process.env.PRISM_CONVEX_SITE_URL;
const PRISM_API_KEY = process.env.PRISM_API_KEY;

if (!PRISM_CONVEX_SITE_URL) {
  console.error("Error: PRISM_CONVEX_SITE_URL environment variable is required");
  process.exit(1);
}

if (!PRISM_API_KEY) {
  console.error("Error: PRISM_API_KEY environment variable is required");
  process.exit(1);
}

// Create client
const client = new PrismClient(PRISM_CONVEX_SITE_URL, PRISM_API_KEY);

// Create MCP server
const server = new McpServer({
  name: "prism",
  version: "1.0.0",
});

// Register all tools
registerPolicyTools(server, client);
registerQuoteTools(server, client);
registerApplicationTools(server, client);
registerThreadTools(server, client);
registerContextTools(server, client);
registerOrgTools(server, client);
registerAgentTools(server, client);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
