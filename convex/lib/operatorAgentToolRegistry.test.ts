import { describe, expect, test } from "vitest";

import { normalizeOperatorCoiBatch } from "../operatorAgent";
import { generateCoiInputSchema, lookupAddressInputSchema } from "./chatTools";
import { OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES } from "./operatorAgentConfirmationPreflight";
import {
  PROCUREMENT_CAPABILITIES,
  PROCUREMENT_CAPABILITY_EXCEPTIONS,
  PROCUREMENT_CAPABILITY_MANIFEST_VERSION,
} from "./procurementCapabilities";
import {
  getOperatorAgentToolSpec,
  operatorAgentToolCatalog,
  parseOperatorAgentToolInput,
} from "./operatorAgentToolRegistry";

describe("operator certificate tools", () => {
  test("requires a registered preflight for every exact-confirmed tool", () => {
    const exactConfirmedTools = operatorAgentToolCatalog()
      .filter((tool) => tool.confirmation === "exact")
      .map((tool) => tool.name)
      .sort();

    expect([...OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES].sort()).toEqual(
      exactConfirmedTools,
    );
  });

  test("reuses the shared COI and address schemas with the correct effects", () => {
    const address = getOperatorAgentToolSpec("lookup_address");
    const generate = getOperatorAgentToolSpec("generate_coi");

    expect(address).toMatchObject({
      inputSchema: lookupAddressInputSchema,
      effect: "read",
      confirmation: "none",
      execution: "action",
    });
    expect(generate).toMatchObject({
      inputSchema: generateCoiInputSchema,
      capability: "operator.certificates.write",
      effect: "reversible_write",
      confirmation: "exact",
      execution: "action",
    });
    expect(
      parseOperatorAgentToolInput("generate_coi", {
        policyId: "policy-1",
        certificateHolder: "ReLease Coverage Company Inc.",
        holderContactName: "Terry Wang",
      }),
    ).toMatchObject({
      policyId: "policy-1",
      certificateHolder: "ReLease Coverage Company Inc.",
      holderContactName: "Terry Wang",
    });
  });

  test("turns generated certificate rows into protected thread attachments", () => {
    const normalized = normalizeOperatorCoiBatch({
      status: "completed",
      generationBatchId: "batch-1",
      results: [
        {
          status: "generated",
          policyId: "policy-1",
          fileId: "storage-1",
          fileName: "certificate-of-insurance.pdf",
          size: 1_024,
          certificateVersionId: "version-1",
          url: "https://storage.example/private-token",
        },
      ],
      gaps: [],
    });

    expect(normalized.attachments).toEqual([
      {
        fileId: "storage-1",
        filename: "certificate-of-insurance.pdf",
        contentType: "application/pdf",
        size: 1_024,
      },
    ]);
    expect(normalized.result).toMatchObject({
      status: "completed",
      generationBatchId: "batch-1",
      certificates: [
        {
          status: "generated",
          policyId: "policy-1",
          certificateVersionId: "version-1",
        },
      ],
      gaps: [],
    });
    expect(JSON.stringify(normalized.result)).not.toContain("private-token");
  });
});

describe("operator procurement tools", () => {
  test("keeps every browser procurement capability agent-backed or explicitly excepted", () => {
    expect(PROCUREMENT_CAPABILITY_MANIFEST_VERSION).toBe(1);
    expect(PROCUREMENT_CAPABILITY_EXCEPTIONS).toEqual([
      expect.objectContaining({ id: "packet.resolve_generated_change" }),
    ]);
    for (const capability of PROCUREMENT_CAPABILITIES) {
      if (!("agentTools" in capability)) continue;
      expect(capability.agentTools.length, capability.id).toBeGreaterThan(0);
      for (const toolName of capability.agentTools) {
        expect(getOperatorAgentToolSpec(toolName), capability.id).toBeTruthy();
      }
    }
  });

  test("keeps procurement reads unconfirmed and every write exact-confirmed", () => {
    for (const name of [
      "list_procurement_requests",
      "get_procurement_request",
      "get_procurement_forwarding_address",
      "list_procurement_email_threads",
      "get_procurement_email_thread",
      "preview_procurement_email_reconciliation",
      "lookup_procurement_packet",
      "preview_broker_packet",
      "list_broker_packet_links",
    ]) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.procurement.read",
        effect: "read",
        confirmation: "none",
        execution: "mutation",
      });
    }

    for (const name of [
      "create_procurement_request",
      "update_procurement_request",
      "create_procurement_broker_outreach",
      "update_procurement_broker_outreach",
      "create_procurement_file_item",
      "update_procurement_file_item",
      "update_procurement_email_thread",
      "update_procurement_packet_section",
      "file_procurement_proposal",
      "file_procurement_email_quote",
      "archive_procurement_proposal",
    ]) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.procurement.write",
        effect: "reversible_write",
        confirmation: "exact",
        execution: "mutation",
      });
    }

    expect(getOperatorAgentToolSpec("create_broker_packet_link")).toMatchObject(
      { effect: "access_change", confirmation: "exact" },
    );
    expect(getOperatorAgentToolSpec("send_broker_packet")).toMatchObject({
      effect: "external_send",
      confirmation: "exact",
      execution: "action",
    });
    expect(
      getOperatorAgentToolSpec("generate_procurement_proposal_review"),
    ).toMatchObject({ confirmation: "exact", execution: "action" });
    expect(
      getOperatorAgentToolSpec("create_client_organization"),
    ).toMatchObject({
      capability: "operator.organizations.write",
      effect: "reversible_write",
      confirmation: "exact",
      execution: "action",
    });
    for (const name of [
      "retry_procurement_proposal_extraction",
      "cancel_procurement_proposal_extraction",
    ] as const) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.extractions.write",
        effect: "reversible_write",
        confirmation: "exact",
        execution: "mutation",
      });
    }
  });

  test("files proposals as one artifact-backed command", () => {
    const input = parseOperatorAgentToolInput("file_procurement_proposal", {
      procurementRequestId: "request-1",
      procurementOutreachId: "outreach-1",
      clientFileIds: ["client-file-1"],
      procurementFileItemIds: ["file-item-1"],
      attachmentFileIds: ["quote.pdf"],
    });
    expect(input).toMatchObject({
      procurementRequestId: "request-1",
      procurementOutreachId: "outreach-1",
      attachmentFileIds: ["quote.pdf"],
    });
    expect(() =>
      parseOperatorAgentToolInput("file_procurement_proposal", {
        procurementRequestId: "request-1",
        procurementOutreachId: "outreach-1",
      }),
    ).toThrow("At least one proposal artifact");
  });

  test("files an imported email quote only from exact thread and outreach references", () => {
    expect(
      parseOperatorAgentToolInput("file_procurement_email_quote", {
        procurementEmailThreadId: "email-thread-1",
        procurementOutreachId: "outreach-1",
      }),
    ).toEqual({
      procurementEmailThreadId: "email-thread-1",
      procurementOutreachId: "outreach-1",
    });
  });

  test("supports filing a thread attachment into a procurement request", () => {
    expect(getOperatorAgentToolSpec("add_client_file")).toMatchObject({
      capability: "operator.client_files.write",
      effect: "reversible_write",
      confirmation: "none",
      execution: "mutation",
    });
    expect(
      getOperatorAgentToolSpec("create_procurement_file_item"),
    ).toMatchObject({
      capability: "operator.procurement.write",
      effect: "reversible_write",
      confirmation: "exact",
      execution: "mutation",
    });
  });

  test("treats a null optional reference as an omitted one", () => {
    const input = parseOperatorAgentToolInput("create_procurement_request", {
      orgId: "organization-1",
      title: "Building purchase",
      narrative: "Arrange coverage for the acquisition.",
      replacingPolicyId: null,
      resultingPolicyId: null,
    });

    expect(input.replacingPolicyId).toBeNull();
    expect(
      getOperatorAgentToolSpec("create_procurement_request").summarize(input),
    ).toBe(
      'Create procurement request "Building purchase" for organization organization-1',
    );
  });

  test("drops nulls nested inside a tool object", () => {
    const input = parseOperatorAgentToolInput("create_broker_network_profile", {
      name: "Blue Lagoon Insurance Services",
      website: null,
      officeAddress: { city: "Austin", state: "TX", street2: null },
    });

    expect(input.website).toBeNull();
    expect(input.officeAddress).toEqual({ city: "Austin", state: "TX" });
  });

  test("shows procurement policy links in the exact confirmation", () => {
    const spec = getOperatorAgentToolSpec("create_procurement_request");
    const input = parseOperatorAgentToolInput("create_procurement_request", {
      orgId: "organization-1",
      title: "Building purchase",
      narrative: "Arrange coverage for the acquisition.",
      replacingPolicyId: "policy-1",
      resultingPolicyId: "policy-2",
    });

    expect(spec.summarize(input)).toBe(
      'Create procurement request "Building purchase" for organization organization-1 with replacing policy policy-1 and resulting policy policy-2',
    );
  });
});

describe("operator client parity tools", () => {
  test("registers rich policy, compliance, file, history, and memory reads", () => {
    for (const name of [
      "lookup_policy",
      "compare_coverages",
      "lookup_policy_section",
      "attach_policy_document",
      "lookup_compliance_requirements",
      "read_client_file",
      "attach_client_file",
      "search_thread_history",
      "read_thread_attachment",
    ]) {
      expect(getOperatorAgentToolSpec(name), name).toMatchObject({
        effect: "read",
        confirmation: "none",
        execution: "action",
      });
    }
    expect(getOperatorAgentToolSpec("lookup_client_wiki")).toMatchObject({
      effect: "read",
      confirmation: "none",
      execution: "mutation",
    });
    expect(
      getOperatorAgentToolSpec("update_client_wiki_section"),
    ).toMatchObject({
      effect: "reversible_write",
      confirmation: "exact",
    });
    expect(getOperatorAgentToolSpec("confirm_policy_fact")).toMatchObject({
      effect: "reversible_write",
      confirmation: "exact",
      execution: "action",
    });
  });
});
