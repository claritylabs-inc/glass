import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { transcribeAudioForOrg } from "./models";

describe("audio transcription routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses the broker voice route and sends a bounded multipart request", async () => {
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    const fetchMock = vi.fn(async () =>
      Response.json({ text: "Transcribed request." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      { runQuery } as never,
      "org-1" as Id<"organizations">,
      {
        data: Buffer.from("voice"),
        filename: "Audio Message.caf",
        mediaType: "audio/mp4",
        prompt: "Preserve insurance terminology.",
      },
    );

    expect(result).toMatchObject({
      text: "Transcribed request.",
      route: {
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
      },
      routeSource: "broker",
      transport: "direct",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-openai-key",
    });
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("prompt")).toBe("Preserve insurance terminology.");
    expect((form.get("file") as File).name).toBe("Audio Message.m4a");
  });

  test("rejects a successful response without a JSON transcript", async () => {
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Transcribed request.", { status: 200 })),
    );

    await expect(
      transcribeAudioForOrg(
        { runQuery } as never,
        "org-1" as Id<"organizations">,
        {
          data: Buffer.from("voice"),
          filename: "Audio Message.m4a",
          mediaType: "audio/mp4",
        },
      ),
    ).rejects.toThrow("returned invalid JSON");
  });
});
