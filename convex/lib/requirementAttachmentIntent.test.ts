import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  requiredRequirementImportStep,
  validateRequirementAttachmentDecision,
} from "./requirementAttachmentIntent";

const file = (filename: string, id = filename) => ({
  filename,
  contentType: "application/pdf",
  fileId: id as Id<"_storage">,
});

describe("requirement attachment decisions", () => {
  it("auto-authorizes only explicit, high-confidence, exact requirement sources", () => {
    const source = file("Program Manager Agreement.pdf", "agreement");
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "analyze_new_requirements",
          intentEvidence: "check whether we meet this attached agreement",
          scope: "own_org",
          selectedFileIds: ["agreement"],
          documents: [
            {
              fileId: "agreement",
              classification: "insurance_requirements",
              confidence: 0.98,
            },
          ],
          confidence: 0.96,
        },
        [source],
      ),
    ).toMatchObject({
      authorization: "auto",
      attachments: [source],
      scope: "own_org",
    });
  });

  it("requires confirmation for mixed or ambiguous scope", () => {
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "import_new_requirements",
          intentEvidence: "import the attached requirements",
          scope: "mixed",
          selectedFileIds: ["requirements"],
          documents: [
            {
              fileId: "requirements",
              classification: "insurance_requirements",
              confidence: 0.95,
            },
          ],
          confidence: 0.95,
        },
        [file("Requirements.pdf", "requirements")],
      ).authorization,
    ).toBe("confirmation");
  });

  it("never selects a policy classified as a requirement source", () => {
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "analyze_new_requirements",
          intentEvidence: "compare this policy with saved requirements",
          scope: "own_org",
          selectedFileIds: ["policy"],
          documents: [
            {
              fileId: "policy",
              classification: "insurance_policy",
              confidence: 0.99,
            },
          ],
          confidence: 0.99,
        },
        [file("Zurich E&O Policy.pdf", "policy")],
      ).attachments,
    ).toEqual([]);
  });

  it("rejects selected IDs that were not supplied by the server", () => {
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "import_new_requirements",
          intentEvidence: "import requirements",
          scope: "vendors",
          selectedFileIds: ["fabricated"],
          documents: [
            {
              fileId: "fabricated",
              classification: "insurance_requirements",
              confidence: 1,
            },
          ],
          confidence: 1,
        },
        [file("Requirements.pdf", "real")],
      ).authorization,
    ).toBe("none");
  });

  it("forces canonical import and lookup only for authorized decisions", () => {
    expect(requiredRequirementImportStep(0, true)?.toolChoice.toolName).toBe(
      "import_requirement_attachments",
    );
    expect(requiredRequirementImportStep(1, true)?.toolChoice.toolName).toBe(
      "lookup_compliance_requirements",
    );
    expect(requiredRequirementImportStep(0, false)).toBeUndefined();
  });
});
