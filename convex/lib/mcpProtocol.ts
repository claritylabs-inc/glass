// MCP protocol version negotiation for the `/mcp` endpoint.
//
// Pinning one old revision makes clients drop fields that only exist in later
// ones: `serverInfo.icons` arrived in 2025-11-25, so a pinned 2025-03-26
// response hides the Spot logo in every client's connector list.

export const LATEST_MCP_PROTOCOL_VERSION = "2025-11-25";

export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [
  LATEST_MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export function negotiateMcpProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return LATEST_MCP_PROTOCOL_VERSION;
  return SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_MCP_PROTOCOL_VERSION;
}
