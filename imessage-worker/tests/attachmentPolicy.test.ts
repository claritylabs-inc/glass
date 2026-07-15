import { describe, expect, test } from "vitest";
import {
  isVoiceMemoContent,
  readInboundAttachmentWith,
  voiceMemoFilename,
  type EnsureM4a,
} from "../src/attachmentPolicy";

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

  test("converts voice bytes to M4A and forwards them as audio", async () => {
    const m4a = Buffer.alloc(16);
    m4a.write("ftyp", 4, "ascii");
    m4a.write("M4A ", 8, "ascii");

    const conversions: Array<{ bytes: Buffer; mimeType: string }> = [];
    const ensureM4a: EnsureM4a = async (bytes, mimeType) => {
      conversions.push({ bytes, mimeType });
      return { buffer: bytes };
    };

    const attachment = await readInboundAttachmentWith(ensureM4a, {
      mimeType: "audio/x-m4a",
      name: "Audio Message.caf",
      read: async () => m4a,
    });

    expect(conversions).toEqual([{ bytes: m4a, mimeType: "audio/x-m4a" }]);
    expect(attachment).toEqual({
      data: m4a.toString("base64"),
      mimeType: "audio/mp4",
      name: "Audio Message.m4a",
    });
  });

  test("leaves non-audio attachments unchanged", async () => {
    const ensureM4a: EnsureM4a = async () => {
      throw new Error("non-audio attachments must not be converted");
    };
    const image = Buffer.from("image");
    await expect(
      readInboundAttachmentWith(ensureM4a, {
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
