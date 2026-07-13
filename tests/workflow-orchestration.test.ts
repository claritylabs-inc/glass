import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  certificateGeneratedOutcome,
} from "../convex/lib/workflows/certificateRequest";
import { mailboxTaskOutcome } from "../convex/lib/workflows/mailboxTasks";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("workflow orchestration contract", () => {
  it("marks existing certificate reuse as a completed file-return side effect", () => {
    const outcome = certificateGeneratedOutcome({
      params: {
        policyId: "policy-1",
        holderName: "Blank Ventures",
        certificateHolder: "Blank Ventures",
      },
      generated: {
        status: "existing",
        certificateVersionId: "version-1",
      },
      attachment: {
        filename: "COI - Blank Ventures.pdf",
        contentType: "application/pdf",
      },
      artifactData: {
        status: "existing",
        certificateVersionId: "version-1",
      },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.nextAction).toBe("return_existing_certificate");
    expect(outcome.sideEffects).toEqual([
      expect.objectContaining({ kind: "existing_file_returned" }),
    ]);
  });

  it("normalizes no-mailbox coordinator results into connection-needed workflow state", () => {
    const outcome = mailboxTaskOutcome({
      mailboxErrors: [{ message: "No connected email account is available" }],
      searches: [],
      text: "No mailbox connected.",
    });

    expect(outcome.status).toBe("needs_input");
    expect(outcome.nextAction).toBe("connect_mailbox");
    expect(outcome.requiredSlots).toEqual([
      expect.objectContaining({ key: "connectedMailbox" }),
    ]);
  });
});

describe("workflow orchestration wiring", () => {
  it("keeps certificate workflow sequencing in code rather than prompt-only behavior", () => {
    const executors = read("convex/lib/agentToolExecutors.ts");
    const generator = executors.indexOf("internal.certificates.generateForOrg");
    const certificates = read("convex/certificates.ts");
    const lifecycleCandidates = certificates.indexOf(
      "findIssuedCertificateHolderCandidatesInternal",
    );
    const holderUpsert = certificates.indexOf("certificateHolders.upsertInternal");

    expect(generator).toBeGreaterThan(-1);
    expect(executors).not.toContain("findReusableIssuedVersionByHolderNameInternal");
    expect(executors).toContain("ambiguous_certificate_holder");
    expect(lifecycleCandidates).toBeGreaterThan(-1);
    expect(holderUpsert).toBeGreaterThan(-1);
    expect(lifecycleCandidates).toBeLessThan(holderUpsert);
    expect(certificates).not.toContain("reusableHolderMatches");
    expect(executors).not.toContain("certificateAddressRequiredOutcome");
  });

  it("does not expose special wording as proactive COI intake", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const generateCoiBlock = chatTools.slice(
      chatTools.indexOf("export const generateCoi"),
      chatTools.indexOf("export const createImessageGroupChat"),
    );

    expect(generateCoiBlock).not.toMatch(/renewal delivery/i);
    expect(generateCoiBlock).not.toMatch(/special wording/i);
    expect(generateCoiBlock).toContain("holder email address only when the user explicitly asks");
  });

  it("stores workflow outcomes from web, inbound email, and iMessage tool results", () => {
    const audit = read("convex/lib/agentToolAudit.ts");

    expect(read("convex/actions/processThreadChat.ts")).toContain(
      'type: "workflow_outcome"',
    );
    expect(audit).toContain("workflowOutcomes");
    expect(audit).toContain("workflowOutcome");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain(
      "collectToolAudit(result).workflowOutcomes",
    );
    expect(read("convex/actions/handleInboundImessage.ts")).toContain(
      "workflowOutcomes",
    );
  });

  it("lets the email COI attachment path pass holder address fields through", () => {
    const emailSubagent = read("convex/lib/emailSubagent.ts");

    expect(emailSubagent).toContain("addressLine1: z.string().optional()");
    expect(emailSubagent).toContain("addressLine2: z.string().optional()");
    expect(emailSubagent).toContain("postalCode: z.string().optional()");
    expect(emailSubagent).toContain("country: z.string().optional()");
    expect(emailSubagent).toContain("addressLine1,");
    expect(read("convex/lib/coiAttachmentGuards.ts")).toContain(
      "addressLine1?: string",
    );
    expect(read("convex/actions/sendCertificateWorkflowJob.ts")).toContain(
      "country: prepared.holder.address?.country",
    );
  });
});
