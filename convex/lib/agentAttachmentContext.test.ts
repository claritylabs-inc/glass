import type { ModelMessage } from "ai";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  buildAgentAttachmentParts,
  modelMessagesHaveImageInput,
  withLatestUserAttachmentParts,
} from "./agentAttachmentContext";

describe("shared agent attachment context", () => {
  test("adds bounded text and image parts to the latest user turn", async () => {
    const textId = "text-file" as Id<"_storage">;
    const imageId = "image-file" as Id<"_storage">;
    const blobs = new Map<string, Blob>([
      [String(textId), new Blob(["policy,premium\nGL-1,1200"])],
      [String(imageId), new Blob([new Uint8Array([1, 2, 3])])],
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
          fileId: textId,
          filename: "renewals.csv",
          contentType: "text/csv",
          size: 24,
        },
        {
          fileId: imageId,
          filename: "declarations.png",
          contentType: "image/png",
          size: 3,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );
    const history: ModelMessage[] = [
      { role: "user", content: "Review these files." },
    ];
    const augmented = withLatestUserAttachmentParts(history, context.parts);

    expect(context.names).toEqual(["renewals.csv", "declarations.png"]);
    expect(context.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("GL-1,1200"),
        }),
        expect.objectContaining({ type: "image", mediaType: "image/png" }),
      ]),
    );
    expect(modelMessagesHaveImageInput(augmented)).toBe(true);
    expect(augmented.at(-1)).toMatchObject({ role: "user" });
  });
});
