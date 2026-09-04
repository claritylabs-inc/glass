import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import { uploadPromptFiles } from "./thread-prompt";

describe("prompt file uploads", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("rejects a failed upload so the composer can preserve its draft", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "blob:test-file") {
        return new Response(new Blob(["evidence"]));
      }
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const uploadIntentId =
      "failed-upload-intent" as Id<"operatorAgentUploadIntents">;
    const onUploadTarget = vi.fn();
    await expect(
      uploadPromptFiles(
        [
          {
            type: "file",
            filename: "evidence.txt",
            mediaType: "text/plain",
            url: "blob:test-file",
          },
        ],
        async () => ({
          uploadUrl: "https://uploads.example.test/file",
          uploadIntentId,
        }),
        { failOnUploadError: true, onUploadTarget },
      ),
    ).rejects.toThrow("Attachment upload failed (503)");
    expect(onUploadTarget).toHaveBeenCalledWith({
      uploadUrl: "https://uploads.example.test/file",
      uploadIntentId,
    });
  });

});
