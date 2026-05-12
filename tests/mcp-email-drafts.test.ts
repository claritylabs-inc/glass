import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("MCP email draft tools", () => {
  it("exposes the shared durable email draft lifecycle through remote and local MCP", () => {
    const http = readFileSync(join(ROOT, "convex/http.ts"), "utf-8");
    const emailDrafts = readFileSync(join(ROOT, "convex/actions/emailDrafts.ts"), "utf-8");
    const mcpAgent = readFileSync(join(ROOT, "mcp-server/src/tools/agent.ts"), "utf-8");
    const mcpClient = readFileSync(join(ROOT, "mcp-server/src/client.ts"), "utf-8");

    for (const toolName of [
      "list_email_drafts",
      "draft_email",
      "update_email_draft",
      "send_email_draft",
      "cancel_email_draft",
    ]) {
      expect(http).toContain(`name: "${toolName}"`);
      expect(mcpAgent).toContain(`"${toolName}"`);
    }

    expect(http).toContain("/mcp/email/drafts/upsert");
    expect(http).toContain("/mcp/email/drafts/send");
    expect(http).toContain("/mcp/email/drafts/cancel");
    expect(mcpClient).toContain("upsertEmailDraft");
    expect(mcpClient).toContain("sendEmailDraft");
    expect(emailDrafts).toContain("upsertEmailDraftArtifact");
    expect(emailDrafts).toContain("sendDraftInternal");
  });
});
