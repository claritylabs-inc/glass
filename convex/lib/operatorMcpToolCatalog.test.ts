import { describe, expect, test } from "vitest";

import { buildOperatorMcpToolCatalog } from "./operatorMcpToolCatalog";

describe("operator MCP tool catalog", () => {
  test("publishes each write-capable owner tool exactly once", () => {
    const tools = buildOperatorMcpToolCatalog({
      canWrite: true,
      operatorRole: "owner",
    });
    const names = tools.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("run_operator_task");
    expect(names).toContain("generate_coi");
    expect(names).toContain("create_procurement_request");
    expect(names).toContain("update_procurement_email_thread");
    expect(names).toContain("create_client_memory");
    expect(names).toContain("delete_procurement_memory");
    expect(names).toContain("clear_all_agent_memory");
  });

  test("limits read-only operators to read tools and run status", () => {
    const tools = buildOperatorMcpToolCatalog({
      canWrite: false,
      operatorRole: "operator",
    });
    const names = tools.map(({ name }) => name);

    expect(names).toContain("get_operator_run");
    expect(names).toContain("get_organization");
    expect(names).toContain("lookup_address");
    expect(names).toContain("list_procurement_requests");
    expect(names).toContain("get_procurement_forwarding_address");
    expect(names).toContain("get_procurement_email_thread");
    expect(names).toContain("lookup_policy");
    expect(names).toContain("lookup_compliance_requirements");
    expect(names).toContain("read_client_file");
    expect(names).toContain("lookup_client_memory");
    expect(names).toContain("lookup_procurement_memory");
    expect(names).not.toContain("generate_coi");
    expect(names).not.toContain("create_procurement_request");
    expect(names).not.toContain("update_procurement_email_thread");
    expect(names).not.toContain("create_client_memory");
    expect(names).not.toContain("delete_procurement_memory");
    expect(names).not.toContain("run_operator_task");
    expect(names).not.toContain("retry_failed_policy_extraction");
    expect(names).not.toContain("clear_all_agent_memory");
    expect(tools.every(({ annotations }) => annotations.readOnlyHint)).toBe(
      true,
    );
  });
});
