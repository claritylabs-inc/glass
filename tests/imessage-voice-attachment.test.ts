import { describe, expect, test } from "vitest";
import {
  isVoiceMemoContent,
  readInboundAttachment,
  voiceMemoFilename,
} from "../imessage-worker/src/voiceAttachment";

describe("iMessage voice attachment normalization", () => {
  test("recognizes audio MIME types and normalizes voice memo filenames", () => {
    expect(isVoiceMemoContent({ mimeType: "audio/x-m4a" })).toBe(true);
    expect(
      isVoiceMemoContent({
        mimeType: "application/octet-stream",
        name: "Audio Message.caf",
      }),
    ).toBe(true);
    expect(isVoiceMemoContent({ mimeType: "image/png" })).toBe(false);
    expect(voiceMemoFilename("Audio Message.caf")).toBe("Audio Message.m4a");
    expect(voiceMemoFilename()).toBe("voice-memo.m4a");
  });

  test("forwards M4A voice bytes as a normalized audio attachment", async () => {
    const m4a = Buffer.alloc(16);
    m4a.write("ftyp", 4, "ascii");
    m4a.write("M4A ", 8, "ascii");

    const attachment = await readInboundAttachment({
      mimeType: "audio/x-m4a",
      name: "Audio Message.caf",
      read: async () => m4a,
    });

    expect(attachment).toEqual({
      data: m4a.toString("base64"),
      mimeType: "audio/mp4",
      name: "Audio Message.m4a",
    });
  });

  test("leaves non-audio attachments unchanged", async () => {
    const image = Buffer.from("image");
    await expect(
      readInboundAttachment({
        mimeType: "image/png",
        name: "photo.png",
        read: async () => image,
      }),
    ).resolves.toEqual({
      data: image.toString("base64"),
      mimeType: "image/png",
      name: "photo.png",
    });
  });
});
