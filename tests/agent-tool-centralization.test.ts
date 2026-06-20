import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const surfaces = [
  "convex/actions/processThreadChat.ts",
  "convex/actions/handleInboundEmail.ts",
  "convex/actions/handleInboundImessage.ts",
  "convex/actions/mcpChat.ts",
];

describe("centralized agent tool execution", () => {
  it("keeps chatTools as schema and description only", () => {
    const chatTools = read("convex/lib/chatTools.ts");

    expect(chatTools).toContain("export const generateCoi = tool");
    expect(chatTools).toContain("policy reference");
    expect(chatTools).not.toContain("execute:");
    expect(chatTools).not.toContain("generateForOrg");
  });

  it("owns shared policy, COI, compliance, and PCE execution in one module", () => {
    const executors = read("convex/lib/agentToolExecutors.ts");

    expect(executors).toContain("export function buildAgentToolExecutors");
    expect(executors).toContain("resolvePolicyReferenceForOrg");
    expect(executors).toContain("buildVendorComplianceTools");
    for (const toolName of [
      "lookup_policy",
      "compare_coverages",
      "lookup_policy_section",
      "lookup_compliance_requirements",
      "save_note",
      "attach_policy_document",
      "confirm_policy_fact",
      "generate_coi",
      "create_policy_change_request",
      "add_policy_change_info",
      "draft_policy_change_email",
      "complete_policy_change_from_endorsement",
    ]) {
      expect(executors).toContain(toolName);
    }
  });

  it("routes every shared surface through the central executor", () => {
    for (const path of surfaces) {
      const source = read(path);

      expect(source).toContain("buildAgentToolExecutors");
      expect(source).not.toMatch(/id:\s*params\.policyId as Id<"policies">/);
      expect(source).not.toMatch(/policyId:\s*params\.policyId as Id<"policies">/);
      expect(source).not.toContain("searchPolicyDocumentWithSourceSpans");
      expect(source).not.toContain("buildVendorComplianceTools");
    }
  });

  it("keeps email-specific attachment selection out of COI generation", () => {
    const subagent = read("convex/lib/emailSubagent.ts");
    const imessage = read("convex/actions/handleInboundImessage.ts");

    expect(subagent).toContain("buildAgentToolExecutors");
    expect(subagent).toContain("attachUploadedFile");
    expect(subagent).toContain('["web", "imessage", "mcp"].includes(context.channel)');
    expect(imessage).toContain("let pendingEmailIdForResponse");
    expect(imessage).toContain("pendingEmailId: pendingEmailIdForResponse");
    expect(subagent).not.toContain("internal.certificates.generateForOrg");
    expect(subagent).not.toContain("resolvePolicyReferenceForOrg");
  });

  it("does not use canned iMessage status cues and avoids internal ID copy", () => {
    const inbound = read("convex/actions/handleInboundImessage.ts");
    const internalIdGuardBlock = inbound.slice(
      inbound.indexOf("if (asksForInternalPolicyRecordId(responseText))"),
      inbound.indexOf("// ── 15. Resolve response attachment URLs"),
    );

    expect(inbound).not.toContain("function generateImessageStatusCue");
    expect(inbound).not.toContain("I'll check the policy");
    expect(inbound).not.toContain("I'll check the attachment");
    expect(inbound).toContain("usedTools.includes(\"generate_coi\")");
    expect(inbound).toContain("I haven't generated that COI yet");
    expect(internalIdGuardBlock).not.toMatch(/internal policy|policy record ID|string of characters/i);
  });
});
