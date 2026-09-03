import JSZip from "jszip";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import { buildAgentAttachmentParts } from "./agentAttachmentContext";

describe("shared agent attachment context", () => {

  test("marks empty and budget-omitted files instead of claiming they were read", async () => {
    const emptyId = "empty-file" as Id<"_storage">;
    const omittedId = "omitted-file" as Id<"_storage">;
    const blobs = new Map<string, Blob>([
      [String(emptyId), new Blob([""])],
      [String(omittedId), new Blob(["important evidence"])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: emptyId,
          filename: "empty.txt",
          contentType: "text/plain",
          size: 0,
        },
        {
          fileId: omittedId,
          filename: "later.txt",
          contentType: "text/plain",
          size: 18,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 0 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("No readable text was extracted");
    expect(text).toContain("text budget was exhausted");
  });

  test("fails closed on corrupt and expansion-heavy Office archives", async () => {
    const corruptId = "corrupt-office" as Id<"_storage">;
    const expandedId = "expanded-office" as Id<"_storage">;
    const archive = new JSZip();
    archive.file("xl/worksheets/sheet1.xml", new Uint8Array(33 * 1024 * 1024));
    const compressed = await archive.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const blobs = new Map<string, Blob>([
      [String(corruptId), new Blob(["not a zip archive"])],
      [String(expandedId), new Blob([new Uint8Array(compressed).buffer])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: corruptId,
          filename: "corrupt.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 17,
        },
        {
          fileId: expandedId,
          filename: "expanded.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: compressed.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("corrupt.xlsx");
    expect(text).toContain("expanded.xlsx");
    expect(text.match(/could not be read/g)).toHaveLength(2);
  });
});
