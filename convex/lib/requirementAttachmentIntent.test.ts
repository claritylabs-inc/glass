import { describe, expect, it } from "vitest";
import {
  inferRequirementImportScope,
  requiredRequirementImportStep,
  selectRequirementImportAttachments,
} from "./requirementAttachmentIntent";

const file = (filename: string) => ({
  filename,
  contentType: "application/pdf",
  fileId: `storage:${filename}`,
});

describe("requirement attachment intent", () => {
  it("selects an agreement for an explicit own-insurance requirement check", () => {
    const text =
      "We're renewing our program manager agreement. Can you check if we meet all the insurance requirements?";

    expect(
      selectRequirementImportAttachments(text, [
        file("Program Manager Agreement v2.pdf"),
      ]),
    ).toHaveLength(1);
    expect(inferRequirementImportScope(text)).toBe("own_org");
  });

  it("does not treat an attached policy as a new requirement source", () => {
    expect(
      selectRequirementImportAttachments(
        "Does this policy meet our saved insurance requirements?",
        [file("Zurich E&O Policy.pdf")],
      ),
    ).toEqual([]);
  });

  it("respects an explicit instruction not to persist the attachment", () => {
    expect(
      selectRequirementImportAttachments(
        "Check the requirements in this agreement without saving or importing it.",
        [file("Program Manager Agreement.pdf")],
      ),
    ).toEqual([]);
  });

  it("infers vendor scope when the request concerns vendor requirements", () => {
    expect(
      inferRequirementImportScope(
        "Import the insurance requirements our vendors must meet.",
      ),
    ).toBe("vendors");
  });

  it("requires canonical import and lookup before open-ended analysis", () => {
    expect(requiredRequirementImportStep(0, true)).toEqual({
      toolChoice: {
        type: "tool",
        toolName: "import_requirement_attachments",
      },
    });
    expect(requiredRequirementImportStep(1, true)).toEqual({
      toolChoice: {
        type: "tool",
        toolName: "lookup_compliance_requirements",
      },
    });
    expect(requiredRequirementImportStep(2, true)).toBeUndefined();
    expect(requiredRequirementImportStep(0, false)).toBeUndefined();
  });
});
