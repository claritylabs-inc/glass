import { describe, expect, test } from "vitest";

import { decodeOperatorMcpAttachments } from "./operatorMcpAttachments";

describe("operator MCP attachments", () => {
  test("decodes bounded files and normalizes path-like filenames", () => {
    const attachments = decodeOperatorMcpAttachments([
      {
        filename: "reports\\renewal.csv",
        content_type: "text/csv",
        data_base64: btoa("policy,premium\nGL-1,1200"),
      },
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      filename: "renewal.csv",
      contentType: "text/csv",
    });
    expect(new TextDecoder().decode(attachments[0]?.bytes)).toBe(
      "policy,premium\nGL-1,1200",
    );
  });

  test("rejects malformed base64 and too many files", () => {
    expect(() =>
      decodeOperatorMcpAttachments([
        { filename: "bad.pdf", data_base64: "%%%" },
      ]),
    ).toThrow("invalid base64");
    expect(() =>
      decodeOperatorMcpAttachments(
        Array.from({ length: 11 }, (_, index) => ({
          filename: `${index}.txt`,
          data_base64: "",
        })),
      ),
    ).toThrow("at most 10 files");
  });
});
