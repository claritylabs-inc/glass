import { describe, expect, test } from "vitest";

import { tenantMcpToolAccess } from "./http";

describe("tenant MCP catalog access", () => {
  test("classifies every business mutation as a write", () => {
    for (const name of [
      "generate_policy_certificate",
      "draft_email",
      "update_email_draft",
      "send_email_draft",
      "send_email_drafts",
      "cancel_email_draft",
      "create_insurance_requirement",
      "create_company_memory",
      "update_company_memory",
      "delete_company_memory",
    ]) {
      expect(tenantMcpToolAccess(name), name).toMatchObject({
        effect: "write",
      });
    }
  });

  test("keeps file and memory reads read-scoped and annotates open-world calls", () => {
    for (const name of [
      "list_client_files",
      "get_client_file",
      "list_company_memory",
    ]) {
      expect(tenantMcpToolAccess(name), name).toMatchObject({ effect: "read" });
    }
    expect(tenantMcpToolAccess("ask_spot")).toMatchObject({
      effect: "read",
      openWorld: true,
    });
    expect(tenantMcpToolAccess("delete_company_memory")).toMatchObject({
      destructive: true,
    });
    expect(tenantMcpToolAccess("not_a_tool")).toBeNull();
  });
});
